-- Retained historical categories must not reserve names in the live catalog.
drop index finance.categories_sibling_name;
create unique index categories_sibling_name on finance.categories
  (user_id,kind,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name))
  where deleted_at is null;
