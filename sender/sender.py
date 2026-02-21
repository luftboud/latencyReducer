import asyncio
import json
import sys
from typing import Optional

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")

from gi.repository import Gst, GstWebRTC, GstSdp, GLib

import websockets

Gst.init(None)

WS_URL = "ws://localhost:8000/ws"
ROLE = "sender"

def has_element(name: str) -> bool:
    return Gst.ElementFactory.find(name) is not None

USE_X264 = has_element("x264enc")
USE_VTENC = has_element("vtenc_h264")

if not (USE_X264 or USE_VTENC):
    print("ERROR: No H.264 encoder found (x264enc/vtenc_h264). Check GStreamer install.", file=sys.stderr)
    sys.exit(1)

PIPELINE_X264 = """
videotestsrc is-live=true pattern=smpte !
videoconvert !
clockoverlay time-format="%H:%M:%S" !
x264enc tune=zerolatency speed-preset=ultrafast key-int-max=30 bitrate=1500 !
video/x-h264,profile=baseline !
rtph264pay config-interval=1 pt=96 !
application/x-rtp,media=video,encoding-name=H264,payload=96 !
webrtcbin name=webrtc bundle-policy=max-bundle
"""

PIPELINE_VTENC = """
videotestsrc is-live=true pattern=smpte !
videoconvert !
clockoverlay time-format="%H:%M:%S" !
vtenc_h264 realtime=true allow-frame-reordering=false !
h264parse config-interval=1 !
rtph264pay config-interval=1 pt=96 !
application/x-rtp,media=video,encoding-name=H264,payload=96 !
webrtcbin name=webrtc bundle-policy=max-bundle
"""

class WebRTCSender:
    def __init__(self):
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.pipeline: Optional[Gst.Pipeline] = None
        self.webrtc: Optional[Gst.Element] = None

        self.glib_loop = GLib.MainLoop()
        self.async_loop = asyncio.get_event_loop()

    async def ws_send(self, payload: dict):
        assert self.ws is not None
        await self.ws.send(json.dumps(payload))


    def _on_negotiation_needed(self, element: Gst.Element):
        print("[sender] on-negotiation-needed -> create-offer")
        promise = Gst.Promise.new_with_change_func(self._on_offer_created, element, None)
        element.emit("create-offer", None, promise)

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

    def _on_ice_candidate(self, element: Gst.Element, mlineindex: int, candidate: str):
        asyncio.run_coroutine_threadsafe(
            self.ws_send({
                "type": "candidate",
                "candidate": {"sdpMLineIndex": int(mlineindex), "candidate": candidate}
            }),
            self.async_loop
        )

    # ---------- Remote updates from signaling ----------

    def set_remote_answer(self, sdp_text: str):
        assert self.webrtc is not None

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

    def add_remote_candidate(self, cand_obj: dict):
        assert self.webrtc is not None
        self.webrtc.emit("add-ice-candidate", cand_obj["sdpMLineIndex"], cand_obj["candidate"])

    # ---------- Pipeline ----------

    def build_pipeline(self):
        desc = PIPELINE_X264 if USE_X264 else PIPELINE_VTENC
        encoder_name = "x264enc" if USE_X264 else "vtenc_h264"
        print(f"[sender] building pipeline (encoder={encoder_name})")

        self.pipeline = Gst.parse_launch(desc)
        self.webrtc = self.pipeline.get_by_name("webrtc")
        assert self.webrtc is not None

        # Optional: STUN for non-local networks (LAN usually fine without it)
        # self.webrtc.set_property("stun-server", "stun://stun.l.google.com:19302")

        self.webrtc.connect("on-negotiation-needed", self._on_negotiation_needed)
        self.webrtc.connect("on-ice-candidate", self._on_ice_candidate)

        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self._on_bus_message)

    def _on_bus_message(self, bus: Gst.Bus, msg: Gst.Message):
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

    def start_pipeline(self):
        assert self.pipeline is not None
        self.pipeline.set_state(Gst.State.PLAYING)

    def stop(self):
        try:
            if self.pipeline:
                self.pipeline.set_state(Gst.State.NULL)
        finally:
            if self.glib_loop.is_running():
                self.glib_loop.quit()

    # ---------- Main run ----------

    async def run_ws(self):
        print(f"[sender] connecting WS: {WS_URL}")
        async with websockets.connect(WS_URL) as ws:
            self.ws = ws
            await self.ws_send({"type": "join", "role": ROLE})
            print("[sender] joined signaling as sender")

            self.build_pipeline()
            self.start_pipeline()

            async for raw in ws:
                data = json.loads(raw)
                if data.get("type") == "answer":
                    self.set_remote_answer(data["sdp"])
                elif data.get("type") == "candidate":
                    self.add_remote_candidate(data["candidate"])

    def run(self):
        asyncio.ensure_future(self.run_ws())

        try:
            self.glib_loop.run()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

if __name__ == "__main__":
    WebRTCSender().run()