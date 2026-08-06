#!/usr/bin/env python3
"""
Tekken 6 adhocctl "!ping" chat bot.

Connects directly to your own adhocctl server (port 27312) as a lightweight
"dummy" client -- no PPSSPP, no rendering, no emulation. Logs in, joins the
lobby group real players use, listens to chat, and replies to "!ping" with
the sender's latency -- read from the kernel's own TCP RTT estimate for
their EXISTING connection to the server, not a fresh probe. A fresh probe
(ICMP or otherwise) to a CGNAT'd IP has no return path; traffic on a
connection they already opened does.

Also sends a periodic keepalive ping, matching what real PPSSPP clients do
(proAdhoc.h references a 2-second ping window) -- without it, the server
was dropping this bot for going quiet.

PROTOCOL SOURCE: struct layouts copied field-for-field from PPSSPP's own
source (Core/HLE/proAdhoc.h, Core/HLE/proAdhocServer.cpp on GitHub).

RUN (sudo recommended -- `ss` may need it to see another process's socket
details depending on your system):
    sudo python3 tekken6_ping_bot.py
"""

import socket
import struct
import subprocess
import re
import time
import random

HOST = "127.0.0.1"
PORT = 27312

BOT_NICKNAME = b"Alpha Adhoc manager"
GAME_PRODUCT_CODE = b"ULUS10466"
GROUP_NAME = b"BTLLOBBY"
FAKE_MAC = bytes([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF])

MAC_LEN = 6
NICKNAME_LEN = 128
PRODUCT_CODE_LEN = 9
GROUPNAME_LEN = 8
MESSAGE_LEN = 64

OPCODE_PING = 0
OPCODE_LOGIN = 1
OPCODE_CONNECT = 2
OPCODE_DISCONNECT = 3
OPCODE_SCAN = 4
OPCODE_SCAN_COMPLETE = 5
OPCODE_CONNECT_BSSID = 6
OPCODE_CHAT = 7

OPCODE_SIZES = {
    OPCODE_PING: 1,
    OPCODE_CONNECT: 1 + NICKNAME_LEN + MAC_LEN + 4,
    OPCODE_DISCONNECT: 1 + 4,
    OPCODE_SCAN: 1 + GROUPNAME_LEN + MAC_LEN,
    OPCODE_SCAN_COMPLETE: 1,
    OPCODE_CONNECT_BSSID: 1 + MAC_LEN,
    OPCODE_CHAT: 1 + MESSAGE_LEN + NICKNAME_LEN,
}


def pad(data: bytes, length: int) -> bytes:
    return data[:length].ljust(length, b"\x00")


def build_login_packet() -> bytes:
    return (
        struct.pack("B", OPCODE_LOGIN)
        + pad(FAKE_MAC, MAC_LEN)
        + pad(BOT_NICKNAME, NICKNAME_LEN)
        + pad(GAME_PRODUCT_CODE, PRODUCT_CODE_LEN)
    )


def build_connect_packet() -> bytes:
    return struct.pack("B", OPCODE_CONNECT) + pad(GROUP_NAME, GROUPNAME_LEN)


def build_chat_packet(message: bytes) -> bytes:
    return struct.pack("B", OPCODE_CHAT) + pad(message, MESSAGE_LEN)


def get_rtt(ip: str) -> str:
    """Kernel-tracked TCP RTT for this peer's existing connection to the
    server -- not a fresh probe, which their CGNAT won't route back.
    Filtered to ESTABLISHED connections on our own port (27312) only --
    filtering by destination IP alone also matched unrelated traffic to
    the same IP (e.g. an SSH session from the same network), which is
    what was causing false "multiple players" results.
    If truly multiple *active* game connections share this IP (possible
    under carrier NAT among unrelated strangers), say so rather than
    guessing which one is theirs."""
    try:
        result = subprocess.run(
            ["ss", "-ti", "state", "established",
             f"( sport = :{PORT} and dst {ip} )"],
            capture_output=True, text=True, timeout=3,
        )
        out = result.stdout
        print(f"[debug] ss raw output for {ip}:\n{out!r}")
        matches = re.findall(r"\brtt:([\d.]+)/", out)
        print(f"[debug] {len(matches)} match(es): {matches}")
        if not matches:
            return "no active connection found"
        if len(matches) > 1:
            return "multiple players share your network's IP, can't isolate yours"
        return f"{float(matches[0]):.0f}ms"
    except Exception as e:
        print(f"[debug] exception in get_rtt: {e!r}")
        return "rtt lookup failed"


def main():
    peers = {}

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((HOST, PORT))
    sock.settimeout(1.0)
    print("Connected to adhocctl server.")

    sock.sendall(build_login_packet())
    time.sleep(0.5)
    sock.sendall(build_connect_packet())
    print(f"Joined group {GROUP_NAME.decode()}. Listening for chat...")

    session_start = time.monotonic()
    last_send = time.monotonic()
    KEEPALIVE_INTERVAL = 1.5  # seconds since our own last send, not since last recv

    buf = b""
    while True:
        try:
            data = sock.recv(4096)
            if not data:
                elapsed = time.monotonic() - session_start
                print(f"Server closed the connection after {elapsed:.0f}s.")
                break
            buf += data
        except socket.timeout:
            pass  # no data right now -- fall through to the keepalive check

        # Timed off our own last SEND, not off recv() timing -- otherwise
        # heavy incoming traffic (other players' chat/joins) keeps recv()
        # satisfied indefinitely while the server never hears anything
        # proactive FROM us, and drops us anyway once things go quiet.
        if time.monotonic() - last_send > KEEPALIVE_INTERVAL:
            sock.sendall(struct.pack("B", OPCODE_PING))
            last_send = time.monotonic()

        while buf:
            opcode = buf[0]
            packet_len = OPCODE_SIZES.get(opcode)

            if packet_len is None:
                print(f"Unrecognized opcode {opcode} -- stopping parse.")
                buf = b""
                break

            if len(buf) < packet_len:
                break

            packet, buf = buf[:packet_len], buf[packet_len:]

            if opcode == OPCODE_CONNECT:
                nickname = packet[1:1 + NICKNAME_LEN].split(b"\x00", 1)[0].decode(errors="ignore")
                ip = socket.inet_ntoa(packet[1 + NICKNAME_LEN + MAC_LEN:1 + NICKNAME_LEN + MAC_LEN + 4])
                peers[nickname] = ip
                print(f"Peer joined: {nickname} ({ip})")

            elif opcode == OPCODE_CHAT:
                message = packet[1:1 + MESSAGE_LEN].split(b"\x00", 1)[0].decode(errors="ignore")
                nickname = packet[1 + MESSAGE_LEN:].split(b"\x00", 1)[0].decode(errors="ignore")
                print(f"[{nickname}] {message}")

                cmd = message.strip().lower()
                reply = None

                if cmd == "!ping":
                    if nickname in peers:
                        reply = f"{nickname}: {get_rtt(peers[nickname])}"
                    else:
                        reply = f"{nickname}: no IP on file yet, try again"

                elif cmd in ("!flip", "!coin"):
                    reply = f"{nickname} flipped: {random.choice(['HEADS', 'TAILS'])}"

                elif cmd == "!roll":
                    reply = f"{nickname} rolled: {random.randint(1, 100)}"

                elif cmd in ("!who", "!players"):
                    player_list = ", ".join(peers.keys()) if peers else "none"
                    reply = f"Online ({len(peers)}): {player_list}"[:MESSAGE_LEN]

                elif cmd == "!uptime":
                    mins = (time.monotonic() - session_start) / 60
                    reply = f"Bot up {mins:.0f} min"

                elif cmd in ("!help", "!cmds"):
                    reply = "Cmds: !ping !who !flip !roll !uptime"

                if reply is not None:
                    sock.sendall(build_chat_packet(reply.encode()))
                    last_send = time.monotonic()  # any reply counts as proof of life


if __name__ == "__main__":
    main()
