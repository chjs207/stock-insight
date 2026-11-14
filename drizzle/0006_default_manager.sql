-- Register the former built-in manager once so it can be removed like any other manager.
INSERT OR IGNORE INTO asset_managers (key, name, added_at)
VALUES ('브이아이피자산운용', '브이아이피자산운용', 0);
