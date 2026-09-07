-- Expand season identifiers to user-defined names. Existing codes and rows stay unchanged.
ALTER TABLE val_producer_seasons ALTER COLUMN season TYPE VARCHAR(30);
ALTER TABLE val_producer_seasons DROP CONSTRAINT IF EXISTS val_producer_seasons_season_check;
ALTER TABLE val_producer_seasons ADD CONSTRAINT val_producer_seasons_season_check CHECK (char_length(btrim(season)) BETWEEN 2 AND 30);
