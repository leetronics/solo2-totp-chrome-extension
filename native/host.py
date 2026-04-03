#!/usr/bin/env python3
"""
SoloKeys Secrets Chrome Extension - Native Messaging Host (thin bridge)

Reads one JSON message from Chrome (stdin framing), forwards it to the
solokeys-gui Unix socket, and writes the response back to Chrome.

solokeys-gui must be running for browser-mediated secrets actions to work.
"""

import json
import struct
import sys
from pathlib import Path

_SOCKET_PATH = Path.home() / ".local/share/solokeys-gui/secrets.sock"


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack('=I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))


def send_message(msg):
    data = json.dumps(msg).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    msg = read_message()
    if msg is None:
        send_message({'success': False, 'error': 'No message received'})
        return

    if not _SOCKET_PATH.exists():
        send_message({
            'success': False,
            'error': 'SoloKeys GUI is not running. Please start it first.'
        })
        return

    import socket as _socket
    try:
        with _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM) as s:
            s.connect(str(_SOCKET_PATH))
            data = json.dumps(msg).encode()
            s.sendall(struct.pack('<I', len(data)) + data)

            raw_len = s.recv(4)
            if len(raw_len) < 4:
                send_message({'success': False, 'error': 'Truncated response from GUI'})
                return
            length = struct.unpack('<I', raw_len)[0]
            response_data = b''
            while len(response_data) < length:
                chunk = s.recv(length - len(response_data))
                if not chunk:
                    break
                response_data += chunk
        send_message(json.loads(response_data))
    except Exception as e:
        send_message({'success': False, 'error': str(e)})


if __name__ == '__main__':
    main()
