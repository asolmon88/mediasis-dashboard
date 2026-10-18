-- Migration: 068
-- Purpose: Allow protected Mediasis staff to upload dashboard media for the
-- selected business without requiring membership in every Clerk Organization.

begin;

drop policy if exists "clerk product managers upload product media" on storage.objects;
create policy "clerk product managers upload product media"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1]
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    (
      (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
      and mediasis.current_products_business_id() is not null
    )
    or (
      mediasis.is_current_mediasis_staff()
      and exists (
        select 1
        from mediasis.businesses b
        where b.uid = ((storage.foldername(name))[1])::uuid
          and coalesce(b.active, false)
      )
    )
  )
);

drop policy if exists "clerk product managers update product media" on storage.objects;
create policy "clerk product managers update product media"
on storage.objects for update to authenticated
using (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1]
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    (
      (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
      and mediasis.current_products_business_id() is not null
    )
    or (
      mediasis.is_current_mediasis_staff()
      and exists (
        select 1 from mediasis.businesses b
        where b.uid = ((storage.foldername(name))[1])::uuid
          and coalesce(b.active, false)
      )
    )
  )
)
with check (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1]
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    (
      (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
      and mediasis.current_products_business_id() is not null
    )
    or (
      mediasis.is_current_mediasis_staff()
      and exists (
        select 1 from mediasis.businesses b
        where b.uid = ((storage.foldername(name))[1])::uuid
          and coalesce(b.active, false)
      )
    )
  )
);

drop policy if exists "clerk storefront managers upload app metadata" on storage.objects;
create policy "clerk storefront managers upload app metadata"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'app_metadata'
  and (storage.foldername(name))[1]
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    mediasis.has_business_permission(
      ((storage.foldername(name))[1])::uuid,
      'ordering_app.storefront.manage.full'
    )
    or (
      mediasis.is_current_mediasis_staff()
      and exists (
        select 1 from mediasis.businesses b
        where b.uid = ((storage.foldername(name))[1])::uuid
          and coalesce(b.active, false)
      )
    )
  )
);

commit;
