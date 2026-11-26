-- The supplier link is retired: Purchasing sends the exported form by email and records the reply.
-- Revoke every link issued before, so none of them keeps working even if a supplier page is ever added back.
update access_token set revoked_at = now() where revoked_at is null;
