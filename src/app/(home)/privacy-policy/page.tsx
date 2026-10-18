import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Política de Privacidad | Mediasis",
  description:
    "Política de privacidad de Mediasis para el dashboard y la aplicación operativa de órdenes.",
};

const sections = [
  {
    title: "1. Quiénes somos",
    body: [
      "Mediasis es una plataforma para la gestión operativa de pedidos, productos, ubicaciones, horarios, métodos de pago y configuraciones relacionadas con la atención de negocios que operan en línea.",
      "Esta política aplica al dashboard web de Mediasis y a la aplicación operativa asociada utilizada por negocios autorizados para administrar sus órdenes y catálogo.",
    ],
  },
  {
    title: "2. Información que tratamos",
    body: [
      "Podemos tratar información de la cuenta del negocio y de sus usuarios autorizados, como correo electrónico de acceso, identificadores de usuario, nombre del negocio, logo y configuraciones operativas.",
      "También tratamos información operativa de pedidos y clientes finales que el negocio recibe o administra desde Mediasis, incluyendo nombre, teléfono, correo electrónico cuando exista, estado del pedido, productos, enlaces de rastreo, horarios de preparación y datos de entrega necesarios para operar el servicio.",
      "En el módulo de productos y configuración también podemos tratar imágenes, precios, categorías, métodos de pago, horarios de atención y disponibilidad por ubicación.",
    ],
  },
  {
    title: "3. Cómo usamos la información",
    body: [
      "Usamos la información para autenticar usuarios, mostrar y actualizar órdenes en tiempo real, administrar productos y disponibilidad por ubicación, guardar configuraciones operativas y permitir la atención diaria del negocio.",
      "También usamos ciertos datos para integraciones operativas, por ejemplo enlaces de rastreo y actualizaciones logísticas, así como para mantener seguridad, estabilidad técnica y continuidad del servicio.",
    ],
  },
  {
    title: "4. Integraciones y proveedores",
    body: [
      "Mediasis utiliza servicios tecnológicos de terceros para operar la plataforma, incluyendo infraestructura de base de datos, autenticación, almacenamiento de archivos y servicios relacionados con entregas o mensajería cuando el negocio los habilita.",
      "Cuando una integración de entrega está activa, solo se comparte la información necesaria para crear, actualizar o rastrear la gestión logística correspondiente.",
    ],
  },
  {
    title: "5. Conexión con Meta y Facebook Pixel",
    body: [
      "Si un usuario autorizado conecta un Facebook Pixel desde el dashboard, Mediasis solicita autorización mediante Meta para comprobar su acceso al pixel. Para configurar la conexión tratamos los identificadores de la cuenta y del portafolio empresarial de Meta, el ID del pixel seleccionado y la información técnica necesaria para completar la autorización.",
      "Mediasis guarda el ID del pixel y una credencial de acceso de servidor asociada al negocio. La usamos para que la aplicación de pedidos envíe a Meta los eventos de conversión configurados para ese pixel. La credencial se mantiene en el servidor y no se muestra en el dashboard. Meta también trata la información recibida conforme a sus propias políticas.",
      "Un usuario autorizado puede desconectar el pixel desde el dashboard; esta acción elimina de la configuración activa de Mediasis el ID del pixel y la credencial de envío. También puede retirar el acceso de Mediasis desde las integraciones empresariales de Meta. La desconexión no elimina los eventos que Meta ya haya recibido ni los registros que deban conservarse por motivos legales u operativos.",
      "Para solicitar información, acceso o eliminación de los datos de la conexión con Meta conservados por Mediasis, escriba a soporte@mediasis.cr. La información sobre los eventos de clientes finales enviados desde la aplicación de pedidos se explica también en la política de privacidad de esa aplicación.",
    ],
  },
  {
    title: "6. Pagos y datos sensibles",
    body: [
      "Mediasis muestra y utiliza estados de pago y referencias operativas asociadas a los pedidos cuando son necesarias para la operación del negocio.",
      "Mediasis no está diseñado para almacenar números completos de tarjeta dentro de esta interfaz operativa, salvo que un proveedor especializado y autorizado lo procese externamente según sus propios estándares y políticas.",
    ],
  },
  {
    title: "7. Ubicaciones, dispositivos y notificaciones operativas",
    body: [
      "La plataforma puede tratar información de ubicaciones del negocio y configuraciones por sucursal para determinar qué productos, métodos de pago, horarios y pedidos corresponden a cada punto de operación.",
      "La aplicación operativa también puede reproducir alertas o mostrar información en tiempo real para avisar sobre nuevos pedidos y cambios operativos.",
    ],
  },
  {
    title: "8. Conservación de datos",
    body: [
      "Conservamos la información durante el tiempo necesario para prestar el servicio, cumplir obligaciones contractuales, resolver incidencias, mantener registros operativos y atender requerimientos legales aplicables.",
      "La duración exacta puede variar según la naturaleza del dato, la relación con el negocio y las obligaciones regulatorias correspondientes.",
    ],
  },
  {
    title: "9. Seguridad",
    body: [
      "Aplicamos medidas técnicas y organizativas razonables para proteger la información contra acceso no autorizado, pérdida, alteración o divulgación indebida.",
      "Sin embargo, ningún sistema es completamente infalible, por lo que no podemos garantizar seguridad absoluta en todos los escenarios.",
    ],
  },
  {
    title: "10. Derechos y solicitudes",
    body: [
      "Si eres cliente de un negocio que usa Mediasis y deseas ejercer derechos sobre tus datos personales, te recomendamos contactar primero al negocio responsable de la orden o servicio.",
      "Si eres usuario autorizado de un negocio dentro de Mediasis y necesitas asistencia relacionada con datos, acceso o corrección, puedes escribirnos usando los canales de soporte oficiales de Mediasis.",
    ],
  },
  {
    title: "11. Cambios a esta política",
    body: [
      "Podemos actualizar esta política de privacidad para reflejar cambios operativos, legales o técnicos. Cuando corresponda, publicaremos la versión actualizada en esta misma ruta pública.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_top,_rgba(255,111,97,0.10),_transparent_32%),linear-gradient(to_bottom,_#fff,_#fff7f5)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/auth/login" className="inline-flex items-center gap-3">
            <Image
              src="/mediasis-logo.png"
              alt="Mediasis"
              width={132}
              height={52}
              priority
            />
          </Link>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/auth/login">Volver al login</Link>
          </Button>
        </div>

        <Card className="overflow-hidden rounded-[28px] border-zinc-200/80 bg-white/95 shadow-[0_24px_80px_rgba(0,0,0,0.06)] backdrop-blur">
          <CardHeader className="border-b border-zinc-100 bg-gradient-to-r from-[#fff4f1] via-white to-white px-6 py-8 md:px-10">
            <div className="inline-flex w-fit items-center rounded-full bg-[#ff6f61]/10 px-3 py-1 text-sm font-medium text-[#d55246]">
              Documento público
            </div>
            <CardTitle className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 md:text-4xl">
              Política de Privacidad
            </CardTitle>
            <CardDescription className="max-w-3xl text-base leading-7 text-zinc-600">
              Última actualización: 29 de septiembre de 2026. Este documento describe
              de forma general cómo Mediasis trata la información utilizada en el
              dashboard web y en la aplicación operativa de órdenes.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-8 md:px-10">
            <div className="space-y-8">
              {sections.map((section) => (
                <section key={section.title} className="space-y-3">
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                    {section.title}
                  </h2>
                  <div className="space-y-3 text-sm leading-7 text-zinc-700 md:text-[15px]">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}

              <section className="rounded-3xl border border-[#ff6f61]/15 bg-[#fff7f5] px-5 py-5 text-sm leading-7 text-zinc-700 md:px-6">
                <p>
                  Esta política es un documento operativo general y no constituye
                  asesoría legal. Si necesitas una revisión legal específica para
                  tu negocio, jurisdicción o flujo de datos, te recomendamos
                  validarla con tu asesor legal.
                </p>
              </section>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
