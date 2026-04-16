import asyncio
import json
import sys
import threading
from typing import Optional

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")

from gi.repository import Gst, GstWebRTC, GstSdp, GLib
import websockets

Gst.init(None)

IP = input("Enter IP: ").strip()
WS_URL = "ws://" + IP
ROLE = "sender"

def has_element(name: str) -> bool:
    return Gst.ElementFactory.find(name) is not None

def _on_rtsp_pad_added(self, _src: Gst.Element, pad: Gst.Pad, depay: Gst.Element):
    """
    rtspsrc creates pads dynamically.
    Waits for video RTP pad and then link it to rtph264depay.
    """
    caps = pad.get_current_caps()
    if not caps:
        caps = pad.query_caps(None)
    caps_str = caps.to_string() if caps else ""
    print(f"[sender] rtspsrc pad-added: {caps_str}")

    # H.264 RTP video
    if "application/x-rtp" not in caps_str or "media=(string)video" not in caps_str:
        print("[sender] ignoring non-video RTP pad")
        return

    sink_pad = depay.get_static_pad("sink")
    if not sink_pad:
        print("[sender] ERROR: depay sink pad not found", file=sys.stderr)
        return

    if sink_pad.is_linked():
        print("[sender] depay sink already linked")
        return

    res = pad.link(sink_pad)
    print(f"[sender] rtsp src pad -> depay: {res.value_nick}")


class WebRTCSender:
    def __init__(self):
        """
        ws - socket for signaling
        pipeline - GStreamer pipeline
        webrtc - heart of webrtc in GStreamer, it is used for negotiation, ICE and RTP

        q - waiting queue for linking dynamic pads with webrtc
         _linked_to_webrtc - so we know when we linked to webrtc

         glib_loop - event loop for GStream
         async_loop - separate from global loop for asyncio
         _async_thread - separate thread for asyncio loop

        remote_description_set - to know if program have received SDP answer
        pending_remote_candidates - buffer for ICE candidates

        _offer_started - so negotiation doesn't start until webrtc linked
        """
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.pipeline: Optional[Gst.Pipeline] = None
        self.webrtc: Optional[Gst.Element] = None

        self._q: Optional[Gst.Element] = None
        self._linked_to_webrtc = False

        self.glib_loop = GLib.MainLoop()

        self.async_loop = asyncio.new_event_loop()
        self._async_thread = threading.Thread(target=self._run_async_loop, daemon=True)
        self._async_thread.start()

        self.remote_description_set = False
        self.pending_remote_candidates = []

        self._offer_started = False
        self._link_timer_id = None

    def _run_async_loop(self):
        """
        Function to set self.async_loop as active event loop
        and to start listening for tasks
        """
        asyncio.set_event_loop(self.async_loop)
        self.async_loop.run_forever()

    async def ws_send(self, payload: dict):
        """
        Asynchronously sends data t osignaling server
        """
        if self.ws is None:
            print("[sender] ws_send called but websocket is None", file=sys.stderr)
            return
        try:
            await self.ws.send(json.dumps(payload))
        except Exception as e:
            print(f"[sender] failed to send WS message: {e}", file=sys.stderr)

    # ---------- webrtc callbacks ----------
    def _on_offer_created(self, promise: Gst.Promise, element: Gst.Element, _):
        reply = promise.get_reply()
        offer = reply.get_value("offer")
        element.emit("set-local-description", offer, Gst.Promise.new())

        sdp_text = offer.sdp.as_text()
        print("[sender] offer created, sending to signaling")
        asyncio.run_coroutine_threadsafe(
            self.ws_send({"type": "offer", "sdp": sdp_text}),
            self.async_loop
        )

    def _on_ice_candidate(self, _webrtc, mlineindex: int, candidate: str):
        if not candidate:
            print("[sender] ICE gathering finished (empty candidate) – ignoring")
            return
        asyncio.run_coroutine_threadsafe(
            self.ws_send({
                "type": "candidate",
                "candidate": {"sdpMLineIndex": int(mlineindex), "candidate": candidate}
            }),
            self.async_loop
        )

    # ---------- Remote updates from signaling ----------

    def set_remote_answer(self, sdp_text: str):
        if self.webrtc is None:
            print("[sender] got remote answer but webrtc is not ready", file=sys.stderr)
            return

        res, sdpmsg = GstSdp.SDPMessage.new()
        if res != GstSdp.SDPResult.OK:
            print("[sender] ERROR: SDPMessage.new failed", file=sys.stderr)
            return

        res = GstSdp.sdp_message_parse_buffer(bytes(sdp_text, "utf-8"), sdpmsg)
        if res != GstSdp.SDPResult.OK:
            print("[sender] ERROR: SDP parse failed", file=sys.stderr)
            return

        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdpmsg)
        print("[sender] setting remote answer")
        self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())

        self.remote_description_set = True

        # flush pending candidates
        for cand in self.pending_remote_candidates:
            self.webrtc.emit("add-ice-candidate", cand["sdpMLineIndex"], cand["candidate"])
        self.pending_remote_candidates.clear()

    def add_remote_candidate(self, cand_obj: dict):
        if self.webrtc is None:
            print("[sender] got remote answer but webrtc is not ready", file=sys.stderr)
            return
        if not self.remote_description_set:
            print("[sender] buffering remote ICE (remote description not set yet)")
            self.pending_remote_candidates.append(cand_obj)
            return
        self.webrtc.emit("add-ice-candidate", cand_obj["sdpMLineIndex"], cand_obj["candidate"])

    # ---------- Pipeline ----------

    def build_pipeline(self):
        """
        Building video pipeline that will be sent to signaling server.
        """
        rtsp_url = (
            "rtsp://admin:iloveacs2026@192.168.1.150:554/cam/realmonitor?channel=1&subtype=1"
        )
        print("[sender] building RTSP -> WebRTC pipeline")

        # ---- creating pipeline container ----
        self.pipeline = Gst.Pipeline.new("pipe")
        if not self.pipeline:
            raise RuntimeError("Failed to create Gst.Pipeline")

        # ---- source from Dahua camera ----
        src = Gst.ElementFactory.make("rtspsrc", "src")
        if not src:
            raise RuntimeError("Failed to create rtspsrc (check gst-plugins-good).")
        src.set_property("location", rtsp_url)
        src.set_property("latency", 100)
        src.set_property("protocols", "tcp")

        # ---- remove RTP container from RTSP video ----
        depay = Gst.ElementFactory.make("rtph264depay", "depay")
        if not depay:
            raise RuntimeError("Failed to create rtph264depay")

        h264parse = Gst.ElementFactory.make("h264parse", "h264parse")
        if not h264parse:
            raise RuntimeError("Failed to create h264parse")
        h264parse.set_property("config-interval", 1) # puts SPS/PPS periodically so decoder starts normally

        pay = Gst.ElementFactory.make("rtph264pay", "pay") # payloader for standard packing to RTP
        if not pay:
            raise RuntimeError("Failed to create rtph264pay")
        pay.set_property("pt", 96)
        pay.set_property("config-interval", 1)

        rtpcaps = Gst.ElementFactory.make("capsfilter", "rtpcaps") # makes stream explicitly RTP-video-H264
        if not rtpcaps:
            raise RuntimeError("Failed to create capsfilter (rtpcaps)")
        rtp_caps_str = "application/x-rtp,media=video,encoding-name=H264,payload=96"
        rtpcaps.set_property("caps", Gst.Caps.from_string(rtp_caps_str))

        q = Gst.ElementFactory.make("queue", "q") # bufer
        if not q:
            raise RuntimeError("Failed to create queue")

        # ---- webrtcbin ----
        self.webrtc = Gst.ElementFactory.make("webrtcbin", "webrtc")
        if not self.webrtc:
            raise RuntimeError("Failed to create webrtcbin (check gst-plugins-bad/webrtc).")

        self.webrtc.set_property("bundle-policy", "max-bundle") #5-tuple

        # stun so is not localhost-only
        self.webrtc.set_property("stun-server", "stun://stun.l.google.com:19302")

        # tell webrtcbin we will SENDONLY video with these RTP caps
        caps = Gst.Caps.from_string(rtp_caps_str)
        self.webrtc.emit("add-transceiver", GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY, caps)

        # ---- add to pipeline ----
        for e in (src, depay, h264parse, pay, rtpcaps, q, self.webrtc):
            if not e:
                raise RuntimeError("Failed to create GStreamer element (check plugins).")
            self.pipeline.add(e)

        # ---- link pre-webrtc chain step-by-step (so errors are obvious) ----
        def must_link(a, b, label):
            ok = a.link(b)
            print(f"[sender] link {label}: {'OK' if ok else 'FAIL'}")
            if not ok:
                raise RuntimeError(f"Failed link: {label}")

        must_link(depay, h264parse, "depay->h264parse")
        must_link(h264parse, pay, "h264parse->pay")
        must_link(pay, rtpcaps, "pay->rtpcaps")
        must_link(rtpcaps, q, "rtpcaps->queue")

        # store queue for async-link
        self._q = q
        self._linked_to_webrtc = False

        # rtspsrc has dynamic pads -> connect callback
        src.connect("pad-added", _on_rtsp_pad_added, depay)

        # connect signals
        self.webrtc.connect("on-ice-candidate", self._on_ice_candidate)

        # bus watcher
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self._on_bus_message)

        # IMPORTANT: async link queue -> webrtc sink pad (pads may appear later)
        self._link_timer_id = GLib.timeout_add(50, self._try_link_queue_to_webrtc)

    def _try_link_queue_to_webrtc(self):
        if self._linked_to_webrtc:
            return False

        if not self.webrtc or not self._q or not self.pipeline:
            return True

        q_src = self._q.get_static_pad("src")
        if not q_src:
            print("[sender] idle: queue src pad not ready yet")
            return True


        webrtc_sink = self.webrtc.request_pad_simple("sink_%u")
        if not webrtc_sink:
            print("[sender] idle: could not request webrtc sink pad yet")
            return True

        res = q_src.link(webrtc_sink)
        print(f"[sender] idle: link queue->webrtc {webrtc_sink.get_name()}: {res.value_nick}")

        if res == Gst.PadLinkReturn.OK:
            self._linked_to_webrtc = True
            print("[sender] queue linked to webrtc; switching pipeline to PLAYING")
            self.pipeline.set_state(Gst.State.PLAYING)

            # kick negotiation now (in case negotiation-needed fired earlier)
            if not self._offer_started:
                print("[sender] starting offer after link")
                self._offer_started = True
                promise = Gst.Promise.new_with_change_func(self._on_offer_created, self.webrtc, None)
                self.webrtc.emit("create-offer", None, promise)

            return False

        return True
    def _on_bus_message(self, _bus, msg: Gst.Message):
        """
        To get messages on the certain bus
        """
        t = msg.type
        if t == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            print(f"[sender] GST ERROR: {err}\nDEBUG: {dbg}", file=sys.stderr)
            self.stop()
        elif t == Gst.MessageType.WARNING:
            err, dbg = msg.parse_warning()
            print(f"[sender] GST WARNING: {err}\nDEBUG: {dbg}", file=sys.stderr)
        elif t == Gst.MessageType.STATE_CHANGED:
            if msg.src == self.pipeline:
                old, new, pending = msg.parse_state_changed()
                print(f"[sender] pipeline state: {old.value_nick} -> {new.value_nick}")

    def _reset_webrtc_state(self):
        self.remote_description_set = False
        self.pending_remote_candidates.clear()
        self._offer_started = False
        self._linked_to_webrtc = False
        self._q = None
        self.webrtc = None

    def _destroy_pipeline(self):
        if self.pipeline:
            try:
                bus = self.pipeline.get_bus()
                if bus:
                    bus.remove_signal_watch()
            except Exception:
                pass

            if self._link_timer_id is not None:
                GLib.source_remove(self._link_timer_id)
                self._link_timer_id = None

            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None

    def restart_for_new_viewer(self):
        print("[sender] restarting sender state for new viewer")
        self._destroy_pipeline()
        self._reset_webrtc_state()
        self.build_pipeline()
        self.start_pipeline()

    def start_pipeline(self):
        assert self.pipeline is not None
        self.pipeline.set_state(Gst.State.PAUSED)
        print("[sender] pipeline start requested (PAUSED)")

    def stop(self):
        """
        Properly stops the program
        """
        try:
            if self.pipeline:
                self.pipeline.set_state(Gst.State.NULL)
                self.pipeline = None
        finally:
            if self.glib_loop.is_running():
                self.glib_loop.quit()

            if self.async_loop.is_running():
                self.async_loop.call_soon_threadsafe(self.async_loop.stop)

    # ---------- Main run ----------

    async def run_ws(self):
        """
        Connects sender to signaling server.

        1. Opens websocket connection
        2. saves the websocket
        3. sends an offer to join
        4. starts video pipeline
        5. starts cycle of listening signaling
        6. parses json:
         - if we get an answer we save that we've got an SDP
         - if we get an ICE candidate for viewer we save it in corresponding list

        What are ICE candidates? It's a way to know where
        a certain client (in our case - viewer) is available

        """
        print(f"[sender] connecting WS: {WS_URL}")
        try:
            async with websockets.connect(WS_URL) as ws:
                self.ws = ws
                await self.ws_send({"type": "join", "role": ROLE})
                print("[sender] joined signaling as sender")

                async for raw in ws:
                    data = json.loads(raw)

                    if data.get("type") == "send_offer":
                        print("[sender] got send_offer from server")
                        self.restart_for_new_viewer()
                        continue

                    if data.get("type") == "answer":
                        self.set_remote_answer(data["sdp"])
                    elif data.get("type") == "candidate":
                        self.add_remote_candidate(data["candidate"])

        except Exception as e:
            print("[sender] WS loop crashed:", repr(e), file=sys.stderr)
            self.stop()

    def run(self):
        """
        1. runs async coroutine run_ws in asyncio thread
        2. starts GStreamer event loop
        3. Stops at KeyboardInterrupt without an error log
        """
        asyncio.run_coroutine_threadsafe(self.run_ws(), self.async_loop)
        try:
            self.glib_loop.run()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


if __name__ == "__main__":
    WebRTCSender().run()