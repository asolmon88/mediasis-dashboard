import { CalendarRange, CircleDollarSign, Code2, Home, LayoutDashboard, ListChecks, Megaphone, Settings, Smartphone, Tags } from "lucide-react";
import { StatusOptions, TopBarOptionsType } from "./types/dashboardTypes";

// This is sample data.
export const data = {
  navMain1: [
    {
      title: "Configuración",
      url: "#",
      icon: Settings,
      isActive: false,
      items: [
        {
          title: "Logo",
          url: "/admin/logo-settings",
          showInSideBar: true
        },
        {
          title: "Facturación",
          url: "/admin/settings/billing",
          showInSideBar: true
        }
        // {
        //   title: "Settings",
        //   url: "#",
        // },
      ],
    },
    // {
    //   title: "Models",
    //   url: "#",
    //   icon: Bot,
    //   items: [
    //     {
    //       title: "Genesis",
    //       url: "#",
    //     },
    //     {
    //       title: "Explorer",
    //       url: "#",
    //     },
    //     {
    //       title: "Quantum",
    //       url: "#",
    //     },
    //   ],
    // },
    // {
    //   title: "Documentation",
    //   url: "#",
    //   icon: BookOpen,
    //   items: [
    //     {
    //       title: "Introduction",
    //       url: "#",
    //     },
    //     {
    //       title: "Get Started",
    //       url: "#",
    //     },
    //     {
    //       title: "Tutorials",
    //       url: "#",
    //     },
    //     {
    //       title: "Changelog",
    //       url: "#",
    //     },
    //   ],
    // },
    // {
    //   title: "Settings",
    //   url: "#",
    //   icon: Settings2,
    //   items: [
    //     {
    //       title: "General",
    //       url: "#",
    //     },
    //     {
    //       title: "Team",
    //       url: "#",
    //     },
    //     {
    //       title: "Billing",
    //       url: "#",
    //     },
    //     {
    //       title: "Limits",
    //       url: "#",
    //     },
    //   ],
    // },
  ],
  // navSecondary: [
  //   {
  //     title: "Configuración",
  //     url: "/admin/settings",
  //     icon: Settings,
  //   },
  //   {
  //     title: "Get Help",
  //     url: "#",
  //     icon: IconHelp,
  //   },
  //   {
  //     title: "Search",
  //     url: "#",
  //     icon: IconSearch,
  //   },
  // ],
  projects: [
    {
      name: "Inicio",
      url: "/admin",
      icon: Home,
    },
    {
      title: "Órdenes",
      name: "Órdenes",
      url: "#",
      icon: ListChecks,
      isActive: false,
      items: [
        {
          title: "Todas",
          url: "/admin/orders",
          showInSideBar: true
        },
        {
          title: "Tiempo real",
          url: "/admin/orders/realtime",
          showInSideBar: true
        }
        // {
        //   title: "Settings",
        //   url: "#",
        // },
      ],
    },
    {
      title: "Productos",
      name: "Productos",
      url: "#",
      icon: Tags,
      isActive: false,
      items: [
        {
          title: "Todos",
          url: "/admin/products",
          showInSideBar: true
        },
        {
          title: "Categorías",
          url: "/admin/products/categories",
          showInSideBar: true
        },
        {
          title: "Nuevo producto",
          url: "/admin/products/new",
          showInSideBar: false
        },
        {
          title: "Descuentos",
          url: "/admin/products/discounts",
          showInSideBar: true
        },
        {
          title: "Acompañamientos/extras",
          url: "/admin/products/product-option-groups",
          showInSideBar: true
        },
        // {
        //   title: "Settings",
        //   url: "#",
        // },
      ],
    },
    {
      title: "App de pedidos",
      name: "App de pedidos",
      url: "#",
      icon: Smartphone,
      isActive: false,
      items: [
        {
          title: "Inicio",
          url: "/admin/app/start",
          showInSideBar: true
        },
        {
          title: "Checkout",
          url: "/admin/app/checkout",
          showInSideBar: true
        },
        {
          title: "Apariencia",
          url: "/admin/app/appearance",
          showInSideBar: true
        },
        {
          title: "Delivery",
          url: "/admin/app/delivery",
          showInSideBar: true
        },
        {
          title: "Horario",
          url: "/admin/app/open-hours",
          showInSideBar: true
        },
        {
          title: "Horarios especiales",
          url: "/admin/app/closed-special-hours",
          showInSideBar: true
        },
        {
          title: "Métodos de pago",
          url: "/admin/app/payment-methods",
          showInSideBar: true
        },
        {
          title: "Cashback",
          url: "/admin/app/cashback",
          icon: CircleDollarSign,
          showInSideBar: true
        }
        // {
        //   title: "Settings",
        //   url: "#",
        // },
      ],
    },
    {
      title: "App de dashboard",
      name: "App de dashboard",
      url: "#",
      icon: LayoutDashboard,
      isActive: false,
      items: [
        {
          title: "Estados automáticos",
          url: "/admin/dashboard-app/automatic-statuses",
          showInSideBar: true
        },
        {
          title: "Reinicio diario de preparación",
          url: "/admin/dashboard-app/daily-preparation-reset",
          showInSideBar: true
        },
      ],
    },
    {
      title: "Marketing",
      name: "Marketing",
      url: "#",
      icon: Megaphone,
      isActive: false,
      items: [
        {
          title: "Facebook pixel",
          url: "/admin/marketing/facebook-pixel",
          showInSideBar: true,
        },
      ],
    },
    {
      title: "Reservaciones",
      name: "Reservaciones",
      url: "#",
      icon: CalendarRange,
      isActive: false,
      items: [
        {
          title: "Todas",
          url: "/admin/reservations",
          showInSideBar: true
        },
        {
          title: "Horarios",
          url: "/admin/open-hours",
          showInSideBar: true
        },
        {
          title: "Días cerrados",
          url: "/admin/closed-days",
          showInSideBar: true
        },
        // {
        //   title: "Settings",
        //   url: "#",
        // },
      ],
    },
    {
      title: "Desarrollador",
      name: "Desarrollador",
      url: "#",
      icon: Code2,
      isActive: false,
      items: [
        {
          title: "Scripts personalizados",
          url: "/admin/developer/custom-scripts",
          showInSideBar: true
        },
        {
          title: "Webhooks",
          url: "/admin/developer/webhooks",
          showInSideBar: true
        },
      ],
    },
    // {
    //   name: "Sales & Marketing",
    //   url: "#",
    //   icon: PieChart,
    // },
    // {
    //   name: "Travel",
    //   url: "#",
    //   icon: Map,
    // },
  ],
}


export const statusOptions: StatusOptions = {
  'Pendiente': 'pending',
  'Confirmada': 'confirmed',
  'Sentados': 'seated',
  'Completada': 'done',
  'Cancelada': 'cancelled'
};

export const statusColors: StatusOptions = {
  'Pendiente': 'bg-orange-400',
  'Confirmada': 'bg-sky-500',
  'Sentados': 'bg-gray-600',
  'Completada': 'bg-green-600',
  'Cancelada': 'bg-red-600'
};

export const statusOptionsDBToUserReadable = Object.fromEntries(
  Object.entries(statusOptions).map(([es, en]) => [en, es])
) as Record<(typeof statusOptions)[keyof typeof statusOptions], keyof typeof statusOptions>;

export const topBarOptions: TopBarOptionsType = [
  {
    name: "Inicio",
    url: "/start",
  },
  {
    name: "Checkout",
    url: "/checkout",
  },
  {
    name: "Apariencia",
    url: "/appearance",
  },
]
