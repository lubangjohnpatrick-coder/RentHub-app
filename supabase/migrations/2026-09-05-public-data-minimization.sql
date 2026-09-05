-- GoRentHive public-data minimization
-- Restrict direct anon/authenticated SELECT privileges so exact home/listing
-- coordinates, item serials and private profile fields cannot be queried by
-- bypassing the Express public response shape.

revoke select on public.users from anon, authenticated;
grant select (
  id, full_name, avatar, role, is_owner, is_business,
  mobile_verified, email_verified, identity_status, identity_level,
  city, province,
  location_status, location_verified_by,
  vessel_rating, review_count, successful_rentals, cancelled_rentals,
  premium_until, created_at
) on public.users to anon, authenticated;

revoke select on public.listings from anon, authenticated;
grant select (
  id, owner_id, category_id, subcategory_id,
  title, description, price_per_day, security_deposit, estimated_value, deposit_tier,
  availability_start, availability_end,
  location_barangay, location_city, location_province,
  pickup_available, min_verification_level,
  rules, cancellation_policy, condition, accessories,
  featured, featured_until, status, is_bundle, bundle_items,
  view_count, favorite_count, rental_count, created_at, updated_at
) on public.listings to anon, authenticated;

-- Keep existing RLS policies in force. Column grants above are an additional
-- privacy boundary, not a replacement for row-level authorization.
