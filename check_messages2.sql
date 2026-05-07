-- Check all recent messages
SELECT m.direction, m.sender, m.status, LEFT(m.content, 80) as preview, m.sent_at
FROM messages m
ORDER BY m.sent_at DESC
LIMIT 10;

-- Check all contacts named Ahmed
SELECT id, name, phone, tenant_id FROM contacts WHERE name ILIKE '%ahmed%';
