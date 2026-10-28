"""The transport drives `bare_rpc.RPC` through its 0.0.x surface: a `send`
callback passed to the constructor, inbound bytes pumped through `receive`, and
a synchronous `close`. bare-rpc 0.1.0 replaced all three with a `Transport`
object, so pyproject pins the dependency below 0.1. Checking the contract here
turns a loosened pin into one clear failure instead of a mypy error list.
"""

from __future__ import annotations

import inspect

import bare_rpc


def test_rpc_takes_a_send_callback() -> None:
    assert "send" in inspect.signature(bare_rpc.RPC.__init__).parameters


def test_rpc_receive_is_pumped_by_the_caller() -> None:
    assert inspect.iscoroutinefunction(bare_rpc.RPC.receive)


def test_rpc_close_is_synchronous() -> None:
    assert not inspect.iscoroutinefunction(bare_rpc.RPC.close)
