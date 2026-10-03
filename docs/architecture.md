# Porter.AI V0 architecture

Porter owns the Travel domain, independently of Assistant.AI and Coach.AI. Its only authoritative concepts are **Trip**, **Event**, and **Knowledge**. A Trip owns its Events, Knowledge, and lightweight semantic participants; participants are never authentication users in V0.

Events remain generic. `movement`, `accommodation`, and `hire` are the only special-handling fields: each changes deterministic projection behavior. Booking, access expectations, artifacts, temporal/spatial expressions, provenance, and visual data are Event aspects. Artifact metadata contains an opaque storage reference; `ArtifactStorage` is the provider boundary, so Supabase Storage paths never leak into domain or projection code. Original artifacts remain authoritative; derived QR/barcode data is explicitly derivative metadata.

Knowledge is sparse contextual truth. Its plural context fields are JSON arrays and validity is a paired range object. Parking is projected only from current parking-tagged Knowledge; Porter never infers it from movement or tracking.

Source tables are `travel_trips`, `travel_events`, and `travel_knowledge`. Source truth is mutable with optimistic revisions. `TripPacket` is a deterministic, read-only projection: perspective filters source data, leaves drive Past/Now/Next/Later, and parents group children. Assistant should orchestrate semantic service operations; it should not manipulate storage representations or derive current state itself.
