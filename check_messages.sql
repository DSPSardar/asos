SELECT m.direction, m.sender, m.status, LEFT(m.content, 100) as preview, m.sent_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
JOIN contacts ct ON ct.id = (SELECT contact_id FROM leads WHERE id = c.lead_id LIMIT 1)
WHERE ct.name = 'Ahmed Khan'
ORDER BY m.sent_at DESC
LIMIT 10;
