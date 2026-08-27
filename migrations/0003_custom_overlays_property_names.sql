-- Optional WFS PROPERTYNAME list (comma-separated), to let a custom overlay
-- pull a subset of fields instead of everything. NULL = every field, same
-- as today's behavior for existing rows.
ALTER TABLE custom_overlays ADD COLUMN property_names TEXT;
