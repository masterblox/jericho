# Jericho

Jericho is Carlos's private, local-first intelligence OS: an encrypted evidence graph, bounded mission orchestrator, and voice/gesture command center inspired by JERICHO.

Start with the [repository index](INDEX.md) and [canonical architecture](ARCHITECTURE.md). The active implementation, setup, and verification commands live in [`apps/jericho`](apps/jericho/INDEX.md).

From Conductor, the shared **Jericho** run action builds and starts the complete loopback runtime on the workspace port, consumes the one-time private bootstrap without logging its token, and opens the authenticated product in Dia. On macOS, local Core credentials initialize in Keychain on first boot; external connector and optional voice credentials remain explicit configuration.
