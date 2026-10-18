import { Sidebar } from "@/components/ui/sidebar";

export type BusinessLocation ={
  business_location_id: string;
  lat: string,
  lng: string,
  short_name:string,
  phone_number:string
}

export type BusinessLocations = BusinessLocation[];

export type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  // your custom props
  business_locations: BusinessLocations,
};

export type ActiveLocation = {
  activeLocation: BusinessLocation;
}

export type StatusOptions = {
  'Pendiente': string,
  'Confirmada': string,
  'Sentados': string,
  'Completada': string,
  'Cancelada': string
}


export type Reservation = {
  id: string,
  client: {
    phone_number: string;
    first_name: string;
    last_name: string;
  }[] | {
    phone_number: string;
    first_name: string;
    last_name: string;
  };
  created_at: string;
  updated_at: string;
  date: string;
  size: string;
  status: string;
  price: number;
  payment_proof_url: string;
  extra_details: string;
}

export type ReservationFormValues = {
  group_size: number;
  date: Date;
  phone: string;
  first_name: string;
  last_name: string;
}

export type ReservationEditFormValues = {
  group_size: number;
  date: Date;
  status: "pending" | "confirmed" | "seated" | "done" | "cancelled";
}

export type ProductView = {
  product_id: string,
  name: string,
  price: number,
  categories: string[],
  images: string[],
  visibility: boolean
}[]

export type TopBarOptionsType = {
  name: string,
  url: string,
}[]

export type SelectOption = { label: string; value: string };

export type delivery_methods_for_table = {
  uid: string,
  visibility: boolean,
  instructions: string;
  name: string;
}[]

export type payment_methods_for_table = {
  business_payment_method_id: string;
  payment_method_id: string;
  business_location_ids: string[];
  scope: "all" | "specific" | string;
  visible: boolean;
  name: string;
  is_manual?: boolean;
  payee_name?: string | null;
  instructions?: string | null;
}[]

export type BusinessWebhookRow = {
  webhook_id: string;
  endpoint_url: string;
  enabled: boolean;
  scope: "all" | "specific" | string;
  event_types: string[];
  location_ids: string[];
  created_at: string;
  updated_at: string;
  has_secret: boolean;
};

export type BusinessWebhookRows = BusinessWebhookRow[];

export type ProductCategoryTableRow = {
  product_category_id: string;
  name: string;
  visible: boolean;
  sequence: number;
  parent_category_id: string | null;
  has_products: boolean;
}[]

export type ProductCategorySelectable = {
  product_id: string;
  name: string;
  visibility: boolean;
  first_image: string | null;
}[]

export type OrdersTableRow = {
  order_id: string;
  human_order_number: number;
  receipt_url?: string | null;
  created_at: string;
  customer_name: string;
  total: number | null;
  delivery_price?: number | null;
  order_status: string;
  payment_status: string;
  delivery_require_courier: boolean;
  delivery_require_location: boolean;
  payment_managed_by_business: boolean;
};

export type OrdersTablePagination = {
  limit: number;
  offset: number;
  has_more: boolean;
};

export type OrdersTableData = {
  rows: OrdersTableRow[];
  pagination: OrdersTablePagination;
};

export type OrdersTableResponse = {
  success: boolean;
  data?: OrdersTableData;
  message?: string;
};

export type OrderDetailClient = {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string | null;
};

export type OrderDetailOrder = {
  order_id: string;
  human_order_number: number;
  receipt_url: string | null;
  created_at: string;
  client: OrderDetailClient;
  payment_method_name: string | null;
  delivery_method_name: string | null;
  tracking_link: string | null;
  order_status: string | null;
  delivery_price: number | null;
  products_price: number | null;
  drop_off_lat: number | null;
  drop_off_lng: number | null;
  options: unknown;
  uber_delivery_id: string | null;
  products_payment_intent_id: string | null;
  delivery_payment_intent_id: string | null;
  products_payment_status: string | null;
  delivery_payment_status: string | null;
  discount_breakdown: OrderDiscountBreakdown | null;
};

export type OrderDetailItem = {
  name: string;
  quantity: number;
  first_image: string | null;
  options: unknown;
};

export type UberDelivery = {
  uber_delivery_pk: string;
  uber_delivery_id: string;
  uber_uuid: string | null;
  uber_id_last5: string | null;
  uber_customer_id?: string | null;
  attempt_number: number;
  is_active?: boolean;
  delivery_role: "forward" | "return" | "replacement" | "manual" | string;
  parent_uber_delivery_id?: string | null;
  status: string | null;
  courier_imminent: boolean | null;
  live_mode: boolean | null;
  complete: boolean | null;
  tracking_url: string | null;
  route_id: string | null;
  batch_id: string | null;
  short_batch_id: string | null;
  pickup_eta: string | null;
  pickup_ready: string | null;
  pickup_deadline: string | null;
  pickup_completed_at: string | null;
  dropoff_eta: string | null;
  dropoff_ready: string | null;
  dropoff_deadline: string | null;
  delivered_at: string | null;
  fee_cents: number | null;
  currency: string | null;
  courier_name: string | null;
  courier_phone_number: string | null;
  courier_img_href: string | null;
  courier_vehicle_type: string | null;
  courier_vehicle_make: string | null;
  courier_vehicle_model: string | null;
  courier_vehicle_color: string | null;
  courier_vehicle_license_plate: string | null;
  courier_lat: number | null;
  courier_lng: number | null;
  courier_location_updated_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  cancellation_reason: string | null;
  undeliverable_reason: string | null;
  undeliverable_action: string | null;
  proof_picture_url: string | null;
  signature_image_url: string | null;
  signature_signer_name: string | null;
  signature_signer_relationship: string | null;
  last_webhook_event_id: string | null;
  last_webhook_at: string | null;
  integration_error?: string | null;
  integration_error_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type OrderDetailResponse = {
  success: boolean;
  data?: {
    order: OrderDetailOrder;
    items: OrderDetailItem[];
    active_uber_delivery?: UberDelivery | null;
    uber_deliveries?: UberDelivery[];
  };
  message?: string;
};

export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "pending"
  | "accepted"
  | "delivered";

export type OrderClient = {
  first_name: string;
  last_name: string;
  phone_number: string;
};

export type OrderSummary = {
  order_id: string;
  human_order_number: number;
  receipt_url: string | null;
  created_at: string;
  amount: number | null;
  client: OrderClient;
  tracking_link: string | null;
  order_status: OrderStatus;
  status_started_at: string;
  uber_delivery_status?: string | null;
};

export type OrderRealtimeItem = {
  quantity: number;
  total_price: number;
  options: unknown;
  product_variant_name: string;
  image?: string | null;
};

export type OrderRealtimeDeliveryMethod = {
  uid: string;
  name: string;
  require_courier: boolean;
};

export type OrderDiscountBreakdown = {
  code: string;
  title: string;
  ends_at: string | null;
  starts_at: string;
  applies_to: "orders" | "products" | "categories" | string;
  value_type: "percent" | "fixed_amount" | string;
  discount_id: string;
  value_amount: number;
  location_scope: "all" | "specific" | string;
  discount_amount: number;
  eligible_subtotal: number;
  order_total_after_discount: number;
  order_total_before_discount: number;
};

export type OrderRealtimeOrder = {
  order_id: string;
  human_order_number: number;
  receipt_url: string | null;
  created_at: string;
  tracking_link: string | null;
  order_status: OrderStatus | "pending";
  products_price?: number | null;
  delivery_price?: number | null;
  order_options?: unknown;
  uber_delivery_id?: string | null;
  uber_customer_id?: string | null;
  pickup_ready_dt?: string | null;
  pickup_deadline_dt?: string | null;
  delivery_created_at?: string | null;
  uber_delivery?: UberDelivery | null;
  discount_breakdown: OrderDiscountBreakdown | null;
  client: {
    first_name: string;
    last_name: string;
    phone_number: string;
    email: string | null;
  };
  delivery_method: OrderRealtimeDeliveryMethod;
  items: OrderRealtimeItem[];
};

export type OrderRealtimeResponse = {
  success: boolean;
  data?: OrderRealtimeOrder[] | OrderRealtimeOrder;
  message?: string;
};

export type DiscountTypeIcon =
  | "key-round"
  | "shopping-cart"
  | "tag"
  | "package-plus"
  | "hand"
  | "truck";

export type DiscountTypeOption = {
  type: string;
  title: string;
  description: string;
  icon: DiscountTypeIcon;
  available: boolean;
};

export type DiscountFormBlocksConfig = {
  showGeneralBlock: boolean;
  showValueBlock: boolean;
  showMinimumRequirementsBlock: boolean;
  showMaximumUsesBlock: boolean;
  showActiveDatesBlock: boolean;
  showTargetsBlock: boolean;
};

export type DiscountListItem = {
  discount_id: string;
  title: string;
  type: string;
  active: boolean;
  applies_to: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

export type DiscountListRows = DiscountListItem[];

export type DiscountSelectableProduct = {
  product_id: string;
  name: string;
  visibility: boolean;
  first_image: string | null;
};

export type DiscountSelectableCategory = {
  product_category_id: string;
  name: string;
  visible: boolean;
};

export type BusinessHomeTimeSeriesPoint = {
  bucket: string;
  amount?: number;
  count?: number;
  views?: number;
};

export type BusinessHomeBucket = "day" | "week" | "month";

export type BusinessHomeLocationSeriesPoint = {
  bucket: string;
  location_id: string;
  location_name: string;
  amount: number;
};

export type BusinessHomeBreakdownItem = {
  id: string;
  label: string;
  instructions?: string;
  orders_count: number;
  sales_amount: number;
  pct_orders: number;
};

export type BusinessHomeSummary = {
  gross_sales: number;
  orders_count: number;
  avg_ticket: number;
  views: number;
};

export type BusinessHomeInsights = {
  discounted_orders_count: number;
  discounted_orders_pct: number;
  delivery_fee_total: number;
  delivery_fee_avg: number;
  show_delivery_fees: boolean;
  delivery_fee_location_name: string | null;
  cashback_active_customers: number;
  cashback_redeemed_amount: number;
  show_cashback_insights: boolean;
};

export type BusinessHomeMeta = {
  bucket: BusinessHomeBucket;
  location_scope: "single" | "all" | string;
  location_id: string | null;
  date_from: string;
  date_to: string;
};

export type BusinessHomeDashboardData = {
  summary: BusinessHomeSummary;
  timeseries: {
    sales_over_time: BusinessHomeTimeSeriesPoint[];
    orders_over_time: BusinessHomeTimeSeriesPoint[];
    views_over_time: BusinessHomeTimeSeriesPoint[];
    sales_by_location_over_time: BusinessHomeLocationSeriesPoint[];
  };
  breakdowns: {
    delivery_methods: BusinessHomeBreakdownItem[];
    payment_methods: BusinessHomeBreakdownItem[];
  };
  insights: BusinessHomeInsights;
  meta: BusinessHomeMeta;
};

export type BusinessHomeDashboardResponse = {
  success?: boolean;
  message?: string;
  data?: BusinessHomeDashboardData;
} | null;
