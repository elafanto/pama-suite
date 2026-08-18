-- Per-firm sales invoice numbering format (prefix remains separate).
ALTER TABLE firms ADD COLUMN IF NOT EXISTS bill_no_format text NOT NULL DEFAULT 'dash_4';
