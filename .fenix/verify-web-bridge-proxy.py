#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fenix verify web-bridge token-exchange reverse proxy（验证基础设施，非产品代码）。

起草：Administrator（spec=add-session-grouper-and-shell-polish 验证环境阻塞
2026-11-02：dsh web 浏览器鉴权 launch token 为 per-process randomBytes
（dsh-client-connection processLaunchToken），每次 serve boot 必然轮换且无
CLI/env 可钉死；而 web 场景 navigate 静态硬编码 ?token=（每 boot 凭据），
验证引擎 rewrite_scenarios_origin（BASE_URL 铁律）只改写 origin、query 原样
保留 → 每轮 serve 重启后静态 token 必然过期 → authorizeIndex 401 壳层空白
→ 全部 web 断言级联零命中（4 场景整轮 env 失败，judge 已裁决全 env）。

机制（serve 侧钉死，场景/引擎/契约三零改动）：
- 真实 dsh web 由 .fenix/verify-web-bridge.sh serve 分支起在内部端口，
  boot 行解析出真实 launch token 后经 --token 注入本代理；
- 本代理监听引擎注入的 {port}：对 path=/ 且带 ?token= 的请求，在途把
  token 值改写为真实 launch token 再转发——上游照常走 authorizeIndex
  铸签名 cookie、303 + Set-Cookie 原样回传浏览器；token 已正确则原样透传；
- 其余流量（API / SSE / 静态资源）经 http.client 流式中继（read1 逐块
  透传，不缓冲 SSE 长流）；
- WebSocket upgrade（dsh api-gateway registerUpgrade 路由）走原始 socket
  双向 splice：请求行按需 token 改写后原样转发，101 握手字节原样回传，
  此后两端 socket 裸对接直至任一侧关闭。

生命周期：由 serve 脚本 exec 落地，进程组归验证框架（start_new_session），
终局 killpg 连同内部 dsh web 一并回收；本代理无守护化、无常驻监听外的
副作用。
"""

from __future__ import annotations

import argparse
import http.client
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qsl, urlencode

CHUNK = 65536
UPSTREAM_TIMEOUT = 15  # 连接/首字节超时；响应建立后流式转发不限时（SSE 长流）

# hop-by-hop 逐跳头（RFC 2616 13.5.1）：中继 HTTP 时剥离，连接语义由本代理
# 与上游/客户端各自独立建立
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
}


def rewrite_token(path: str, real_token: str) -> str:
    """path=/（含空路径）且带 token 查询参数时，把 token 值统一改写为真实值。

    authorizeIndex 只在 GET / 铸 cookie；其余路径的 token 参数不属于鉴权
    输入，原样透传（保守改写面，避免重演 2026-09-17 属性选择器毒化）。
    """
    parts = urlsplit(path)
    if parts.path not in ("", "/"):
        return path
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    if not any(k == "token" for k, _ in pairs):
        return path
    changed = False
    new_pairs = []
    for k, v in pairs:
        if k == "token":
            if v != real_token:
                v = real_token
                changed = True
        new_pairs.append((k, v))
    if not changed:
        return path
    return f"{parts.path}?{urlencode(new_pairs)}"


class RelayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # 关闭语义逐请求收敛：响应体以连接关闭分界
    server_version = "fenix-verify-token-proxy/1.0"

    # ---- 注入字段（server 实例属性，ThreadingHTTPServer 单例共享） ----
    @property
    def upstream_port(self) -> int:
        return self.server.upstream_port  # type: ignore[attr-defined]

    @property
    def real_token(self) -> str:
        return self.server.real_token  # type: ignore[attr-defined]

    def log_message(self, fmt, *args):  # 安静模式：一行请求摘要到 stdout
        print(f"[proxy] {self.address_string()} {fmt % args}", flush=True)

    # ---- 主分发 ----
    def _relay(self):
        target = rewrite_token(self.path, self.real_token)
        if target != self.path:
            print(f"[proxy] token exchanged: {self.path.split('?')[0]}?token=… -> pinned", flush=True)

        if self.headers.get("Upgrade"):  # WebSocket upgrade：原始 socket splice
            self._splice_upgrade(target)
            return

        try:
            conn = http.client.HTTPConnection(
                "127.0.0.1", self.upstream_port, timeout=UPSTREAM_TIMEOUT
            )
            body = None
            length = self.headers.get("Content-Length")
            if length:
                body = self.rfile.read(int(length))
            # Accept-Encoding / Content-Encoding 原样透传（字节不变形，压缩
            # 响应直接中继即可），仅剥离逐跳头
            headers = {
                k: v for k, v in self.headers.items()
                if k.lower() not in HOP_BY_HOP
            }
            conn.request(self.command, target, body=body, headers=headers)
            resp = conn.getresponse()
        except Exception as exc:  # 上游失联：502（引擎终局按进程组回收）
            print(f"[proxy] upstream error: {exc}", flush=True)
            try:
                self.send_error(502, f"verify upstream unreachable: {exc}")
            except Exception:
                pass
            return

        try:
            self.send_response(resp.status, resp.reason)
            hop = set()
            for v in self.headers.get("Connection", "").split(","):
                hop.add(v.strip().lower())
            for k, v in resp.getheaders():
                if k.lower() in HOP_BY_HOP or k.lower() in hop:
                    continue
                self.send_header(k, v)
            self.send_header("Connection", "close")
            self.end_headers()
            while True:
                data = resp.read1(CHUNK)  # read1：有数据即回，不凑满 CHUNK（SSE 低延迟）
                if not data:
                    break
                self.wfile.write(data)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # 客户端提前断开（场景 wait 超时等），正常收尾
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _splice_upgrade(self, target: str):
        """WebSocket upgrade 原始中继：请求行（token 改写后）+ 头原样转发，
        之后两端 socket 裸对接（101 握手字节原样回传客户端）。"""
        try:
            up = socket.create_connection(("127.0.0.1", self.upstream_port), timeout=UPSTREAM_TIMEOUT)
        except Exception as exc:
            print(f"[proxy] upgrade upstream error: {exc}", flush=True)
            self.send_error(502, f"verify upstream unreachable: {exc}")
            return
        try:
            req_line = f"{self.command} {target} {self.request_version}\r\n"
            up.sendall(req_line.encode("latin-1"))
            for k, v in self.headers.items():
                if k.lower() in HOP_BY_HOP:
                    # Upgrade 头是 upgrade 语义本体，必须转发；
                    # Connection 由下方显式重建（node 侧 'upgrade' 事件要求
                    # Connection: Upgrade + Upgrade: websocket 同时在场）
                    if k.lower() != "upgrade":
                        continue
                up.sendall(f"{k}: {v}\r\n".encode("latin-1"))
            up.sendall(b"Connection: Upgrade\r\n\r\n")

            csock = self.connection  # 客户端原始 socket（header 已读毕，无缓冲体）
            stop = threading.Event()

            def pump(src, dst, tag):
                try:
                    while True:
                        data = src.recv(CHUNK)
                        if not data:
                            break
                        dst.sendall(data)
                except OSError:
                    pass
                finally:
                    stop.set()
                    for s in (src, dst):
                        try:
                            s.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
                    print(f"[proxy] upgrade closed ({tag})", flush=True)

            t1 = threading.Thread(target=pump, args=(csock, up, "client->up"), daemon=True)
            t2 = threading.Thread(target=pump, args=(up, csock, "up->client"), daemon=True)
            t1.start()
            t2.start()
            t1.join()
            t2.join()
        finally:
            try:
                up.close()
            except Exception:
                pass
            self.close_connection = True

    do_GET = _relay
    do_POST = _relay
    do_PUT = _relay
    do_PATCH = _relay
    do_DELETE = _relay
    do_HEAD = _relay
    do_OPTIONS = _relay


def main():
    ap = argparse.ArgumentParser(description="fenix verify web-bridge token-exchange proxy")
    ap.add_argument("--listen-port", type=int, required=True, help="引擎注入的被测端口 {port}")
    ap.add_argument("--upstream-port", type=int, required=True, help="内部 dsh web 真实端口")
    ap.add_argument("--token", required=True, help="本轮 dsh web 真实 launch token")
    args = ap.parse_args()

    ThreadingHTTPServer.upstream_port = args.upstream_port
    ThreadingHTTPServer.real_token = args.token
    httpd = ThreadingHTTPServer(("127.0.0.1", args.listen_port), RelayHandler)
    httpd.daemon_threads = True
    print(
        f"[proxy] listening 127.0.0.1:{args.listen_port} -> 127.0.0.1:{args.upstream_port} "
        f"(launch token pinned: any stale ?token= on / will be exchanged in-flight)",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
