# Next PR: local-first client pipeline

V0 deliberately ships no frontend, sync protocol, or offline cache. The next PR should add a bounded TripPacket endpoint and client cache around the existing `buildTripPacket` contract, including device-local artifact readiness (which the server must not claim). MCP exposure can then adapt `PorterService` operations without exposing raw tables.
