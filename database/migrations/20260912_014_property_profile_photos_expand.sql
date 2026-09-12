-- Reuse the existing profile-photo store for property identification.
ALTER TABLE val_profile_photos DROP CONSTRAINT val_profile_photos_entity_kind_check;
ALTER TABLE val_profile_photos ADD CONSTRAINT val_profile_photos_entity_kind_check
 CHECK (entity_kind IN ('producer','consultant','property'));
