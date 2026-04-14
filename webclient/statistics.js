// previous statistics
let prevNetwork = null;
let prevVideo = null;

let allStatsLog = [];

export function processNetworkStats(stats) {
    let currentStats = {
        rttMs: 0,
        bytesReceived: 0
    };

    stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
            currentStats.rttMs = (report.currentRoundTripTime || 0) * 1000;
            currentStats.bytesReceived = report.bytesReceived || 0;
        }
    });

    const timeNow = performance.now();

    if (!prevNetwork) {
        prevNetwork = { ...currentStats, time: timeNow};
        return null;
    }

    const difference = (timeNow - prevNetwork.time) / 1000;

    const result = {
        rtt: currentStats.rttMs,
        bitrate:
            difference > 0 ? ((currentStats.bytesReceived - prevNetwork.bytesReceived) * 8) / difference / 1000 : 0
    };
    prevNetwork = { ...currentStats, time: timeNow };

    return result;
}

export function processVideoStats(stats) {
    let currentStats = {
        fps: 0,
        framesDecoded: 0,
        framesReceived: 0,
        framesDropped: 0,
        packetsLost: 0,
        packetsReceived: 0,
        totalDecodeTimeMs: 0,
        jitterMs: 0,
        avgBufferDelayMs: 0,
        jitterBufferDelayMs: 0
    };

    stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
            currentStats.fps = report.framesPerSecond || 0;
            currentStats.framesDecoded = report.framesDecoded || 0;
            currentStats.framesReceived = report.framesReceived || 0;
            currentStats.framesDropped = report.framesDropped || 0;
            currentStats.packetsLost = report.packetsLost || 0;
            currentStats.packetsReceived = report.packetsReceived || 0;
            currentStats.totalDecodeTimeMs = (report.totalDecodeTime || 0) * 1000;
            currentStats.jitterMs = (report.jitter || 0) * 1000;
            currentStats.jitterBufferDelayMs = (report.jitterBufferDelay || 0) * 1000;
        }
    });

    if (!prevVideo) {
        prevVideo = { ...currentStats };
        return null;
    }

    const framesDelta = currentStats.framesDecoded - prevVideo.framesDecoded;
    const receivedFramesDelta = currentStats.framesReceived - prevVideo.framesReceived;
    const droppedFramesDelta = currentStats.framesDropped - prevVideo.framesDropped;

    const receivedPacketsDelta = currentStats.packetsReceived - prevVideo.packetsReceived;
    const lostPacketsDelta = currentStats.packetsLost - prevVideo.packetsLost;
    const totalPacketsDelta = receivedPacketsDelta + lostPacketsDelta;
    const lossRate = totalPacketsDelta > 0 ? lostPacketsDelta / totalPacketsDelta : 0;

    const decodeFramesDelta = currentStats.totalDecodeTimeMs - prevVideo.totalDecodeTimeMs;
    const jitterBufferDelta = currentStats.jitterBufferDelayMs - prevVideo.jitterBufferDelayMs;

    const result = {
        fps: currentStats.fps,
        receivedFrames: receivedFramesDelta,
        droppedFrames: droppedFramesDelta,
        lostPackets: lostPacketsDelta,
        receivedPackets: receivedPacketsDelta,
        lossPacketsRate: lossRate,
        decodePerFrameMs: framesDelta > 0 ? decodeFramesDelta / framesDelta : 0,
        jitterMs: currentStats.jitterMs,
        avgBufferDelayMs: framesDelta > 0 ? jitterBufferDelta / framesDelta : 0
    };

    prevVideo = { ...currentStats};
    return result;
}

export function logStatistics(networkStats, videoStats) {
    if (!networkStats || !videoStats) return;

    const row = {
        time: new Date().toISOString(),

        rtt: networkStats.rtt,
        bitrate: networkStats.bitrate,

        fps: videoStats.fps,
        droppedFrames: videoStats.droppedFrames,
        lostPackets: videoStats.lostPackets,
        receivedPackets: videoStats.receivedPackets,
        lossRate: videoStats.lossPacketsRate,

        jitter: videoStats.jitterMs,
        buffer: videoStats.avgBufferDelayMs,
        decode: videoStats.decodePerFrameMs,
    };

    allStatsLog.push(row);
}

export function getStatisticsLog() {
    return allStatsLog;
}
export function saveToCSV(){
    if (!allStatsLog || allStatsLog.length === 0) return;

    const headers = Object.keys(allStatsLog[0]);

    const data = [
        headers.join(","), ...allStatsLog.map(row => headers.map(key => row[key]).join(","))
    ].join("\n");

    const blob = new Blob([data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `webrtc_stats_${Date.now()}.csv`;
    link.click();

    URL.revokeObjectURL(url);
}

export function resetStatistics() {
    prevNetwork = null;
    prevVideo = null;
    allStatsLog = [];
}