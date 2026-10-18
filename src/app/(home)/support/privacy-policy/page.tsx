import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Política de Privacidad de mediasis Soporte",
  description:
    "Información sobre el tratamiento y la eliminación de datos en el servicio de atención al cliente de mediasis por WhatsApp.",
};

const effectiveDate = "23 de julio de 2026";
const privacyEmail = "soporte@mediasis.cr";

const sections = [
  {
    title: "1. Responsable y alcance",
    body: [
      <>
        Esta Política de Privacidad explica cómo <strong>mediasis</strong>, cédula
        jurídica 3102952249, con domicilio en Sabana, San José, Costa Rica
        (“mediasis”, “nosotros”), trata los datos personales que recibe en su
        servicio de atención al cliente (“mediasis Soporte”) por medio de la
        Plataforma de WhatsApp Business y Chatwoot.
      </>,
      <>
        Esta política se aplica a las conversaciones de soporte gestionadas por
        mediasis. Dependiendo de la solicitud, mediasis puede atender el caso
        directamente, coordinarlo con la farmacia o comercio correspondiente,
        o consultar a Uber cuando sea necesario aclarar una entrega realizada por
        sus repartidores.
      </>,
      <>
        Para consultas sobre privacidad puede escribir a{" "}
        <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
      </>,
    ],
  },
  {
    title: "2. Información que recopilamos",
    body: [
      <>
        Cuando una persona se comunica con mediasis Soporte podemos recopilar su
        número de teléfono de WhatsApp; nombre de perfil o nombre para mostrar;
        contenido de los mensajes e historial de la conversación; imágenes,
        documentos, audios u otros archivos que envíe voluntariamente; detalles
        del pedido, entrega, comercio o solicitud de soporte; y cualquier otra
        información que decida proporcionarnos.
      </>,
      <>
        También podemos tratar datos técnicos y operativos, como fechas y horas,
        identificadores de mensajes y conversaciones, estados de envío, entrega y
        lectura, canal de origen, y actividad de los agentes que atienden el caso.
      </>,
      <>
        Solicitamos que no envíe datos sensibles ni documentos innecesarios. Si
        necesitamos información adicional para resolver un caso, procuraremos
        solicitar únicamente la que resulte pertinente.
      </>,
    ],
  },
  {
    title: "3. Para qué usamos la información",
    body: [
      <>
        Utilizamos la información para recibir, organizar, gestionar y resolver
        solicitudes de soporte; identificar o autenticar a clientes cuando sea
        necesario; comunicarnos sobre un caso; investigar pedidos o entregas;
        prevenir fraude, abuso e incidentes de seguridad; mantener la calidad del
        servicio y registros internos; y cumplir obligaciones legales.
      </>,
      <>
        Utilizamos las funciones de analítica de Chatwoot para obtener métricas
        operativas, como volumen de conversaciones, tiempos de respuesta y
        desempeño del servicio y de los agentes.
      </>,
      <>
        Actualmente no enviamos el contenido de las conversaciones o sus archivos
        a herramientas de inteligencia artificial para resumir, clasificar,
        generar respuestas o entrenar modelos. Si en el futuro activamos una
        función de este tipo, actualizaremos esta política y, cuando corresponda,
        informaremos a las personas antes de realizar el nuevo tratamiento.
      </>,
    ],
  },
  {
    title: "4. Marketing",
    body: [
      <>
        Este canal se utiliza exclusivamente para soporte. Las conversaciones de
        soporte no se usan para enviar publicidad o marketing no solicitado.
      </>,
      <>
        Si en el futuro mediasis ofrece comunicaciones promocionales por WhatsApp,
        se enviarán únicamente con el consentimiento previo que corresponda y
        cada persona podrá retirar ese consentimiento o dejar de recibirlas
        mediante instrucciones claras, por ejemplo respondiendo “SALIR”. Ese
        cambio se reflejará previamente en esta política.
      </>,
    ],
  },
  {
    title: "5. Proveedores y divulgaciones",
    body: [
      <>
        <a
          href="https://www.whatsapp.com/legal/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          Meta/WhatsApp
        </a>{" "}
        transmite los mensajes de WhatsApp.{" "}
        <a
          href="https://www.chatwoot.com/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          Chatwoot
        </a>{" "}
        proporciona la bandeja de atención, el almacenamiento y las herramientas
        de analítica. Chatwoot Cloud utiliza infraestructura de AWS ubicada en
        Estados Unidos.
      </>,
      <>
        Cuando una solicitud se relaciona con una entrega realizada por
        repartidores de Uber, podemos compartir con{" "}
        <a
          href="https://www.uber.com/legal/privacy/users/"
          target="_blank"
          rel="noreferrer"
        >
          Uber
        </a>{" "}
        únicamente la información razonablemente necesaria para identificar la
        entrega, investigar lo ocurrido y resolver el caso.
      </>,
      <>
        También podemos permitir el tratamiento por proveedores de alojamiento,
        infraestructura, almacenamiento, respaldo, seguridad y soporte técnico
        estrictamente necesarios para operar el servicio, sujetos a obligaciones
        de protección de la información.
      </>,
      <>
        Podemos comunicar información a autoridades administrativas o judiciales
        cuando lo exija la ley, una orden válida o sea necesario para proteger
        derechos y seguridad. <strong>No vendemos datos personales.</strong>
      </>,
    ],
  },
  {
    title: "6. Tratamiento en otros países",
    body: [
      <>
        Meta/WhatsApp, Chatwoot, AWS, Uber y otros proveedores necesarios pueden
        almacenar o procesar información fuera de Costa Rica, incluidos Estados
        Unidos y otros países donde mantienen infraestructura, personal o
        proveedores. Sus prácticas también se rigen por sus propios avisos de
        privacidad, enlazados arriba cuando están disponibles.
      </>,
      <>
        Procuramos seleccionar proveedores adecuados y limitar el acceso y la
        transferencia a lo necesario para prestar el servicio. Las leyes y los
        niveles de protección de otros países pueden ser diferentes de los de
        Costa Rica.
      </>,
    ],
  },
  {
    title: "7. Conservación",
    body: [
      <>
        Las conversaciones de soporte, sus datos asociados y los archivos
        adjuntos se eliminan de los sistemas operativos dentro de los siete días
        calendario siguientes al cierre del caso.
      </>,
      <>
        Las copias de seguridad pueden conservar datos eliminados por un máximo de
        tres meses. Durante ese periodo permanecen protegidas y no se utilizan
        para la operación ordinaria; los datos se eliminan al vencer o
        sobrescribirse la copia correspondiente.
      </>,
      <>
        Excepcionalmente podemos conservar información específica por más tiempo
        cuando exista una obligación legal, una investigación de fraude o
        seguridad, una disputa o la necesidad de formular, ejercer o defender un
        reclamo. En esos casos limitaremos la información y el plazo a lo
        razonablemente necesario.
      </>,
    ],
  },
  {
    title: "8. Seguridad",
    body: [
      <>
        Aplicamos medidas administrativas, técnicas y organizativas razonables,
        como controles de acceso, permisos según funciones, protección de
        credenciales, transmisión protegida, registro de actividad y selección
        de proveedores con medidas de seguridad apropiadas.
      </>,
      <>
        Ningún sistema, transmisión por Internet o servicio de mensajería es
        completamente seguro. Por ello no podemos garantizar seguridad absoluta,
        aunque trabajamos para prevenir accesos, usos, alteraciones, pérdidas o
        divulgaciones no autorizadas.
      </>,
    ],
  },
  {
    title: "9. Derechos de las personas",
    body: [
      <>
        Conforme a la Ley N.º 8968, Ley de Protección de la Persona frente al
        Tratamiento de sus Datos Personales, y demás normativa aplicable, puede
        solicitar información y acceso a sus datos, su corrección o actualización,
        y la eliminación de los datos que proceda. También puede retirar un
        consentimiento previamente otorgado cuando el tratamiento dependa de él.
      </>,
      <>
        Estos derechos están sujetos a las excepciones legales aplicables. Por
        ejemplo, podría ser necesario conservar ciertos datos para cumplir una
        obligación legal, atender una disputa o prevenir fraude. Si no podemos
        atender total o parcialmente una solicitud, explicaremos el motivo cuando
        la ley lo permita.
      </>,
    ],
  },
  {
    title: "10. Cómo presentar una solicitud",
    body: [
      <>
        Envíe un correo a <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>{" "}
        con el asunto “Solicitud de privacidad”. Indique el derecho que desea
        ejercer, el número de teléfono usado en WhatsApp, una descripción del caso
        y la información necesaria para localizar la conversación.
      </>,
      <>
        Para proteger los datos, podemos pedirle que confirme la solicitud desde
        el mismo número de WhatsApp o que proporcione información limitada
        relacionada con la conversación. No solicitaremos más datos de los
        razonablemente necesarios para verificar identidad y autoridad. Si actúa
        en nombre de otra persona, podremos pedir prueba de esa autorización.
      </>,
      <>
        Confirmaremos la recepción y responderemos dentro del plazo establecido
        por la legislación aplicable. La presentación de una solicitud no tiene
        costo, salvo los supuestos expresamente permitidos por ley.
      </>,
    ],
  },
  {
    title: "11. Eliminación de datos de WhatsApp",
    body: [
      <>
        Para solicitar la eliminación de sus datos de WhatsApp, escriba a{" "}
        <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a> con el asunto
        “Eliminación de datos de WhatsApp”. Incluya el número de WhatsApp con
        código de país y, si lo conoce, la fecha aproximada o el número del pedido
        relacionado. No envíe contraseñas ni documentos de identidad por correo.
      </>,
      <>
        Confirmaremos que la solicitud proviene de la persona asociada con el
        número, normalmente mediante un mensaje de verificación al mismo número de
        WhatsApp. Solo si esto no es suficiente solicitaremos información
        adicional limitada.
      </>,
      <>
        Una vez verificada la solicitud, eliminaremos de los sistemas operativos
        elegibles el contacto, las conversaciones, los archivos adjuntos y los
        datos asociados. También gestionaremos la eliminación en Chatwoot y en
        otros sistemas bajo nuestro control. Las copias de seguridad se
        sobrescribirán o vencerán en un máximo de tres meses.
      </>,
      <>
        Informaremos cuando la solicitud se haya completado o si debemos conservar
        algún dato por una excepción legal, de seguridad, fraude o defensa de
        reclamos. Esta solicitud no elimina automáticamente los datos que Meta,
        Uber, la farmacia u otro tercero conserve como responsable independiente
        bajo sus propias políticas; puede ser necesario solicitarles la eliminación
        directamente.
      </>,
    ],
  },
  {
    title: "12. Ley de Costa Rica y tratamiento responsable",
    body: [
      <>
        Tratamos los datos de acuerdo con los principios y obligaciones aplicables
        de la Ley N.º 8968. Esta política procura brindar un aviso informado sobre
        qué datos se recopilan, para qué fines determinados y legítimos se usan,
        con quién pueden compartirse, cuánto tiempo se conservan y cómo ejercer
        derechos.
      </>,
      <>
        Procuramos recopilar datos adecuados y no excesivos, mantenerlos correctos
        cuando sea necesario, utilizarlos de forma responsable únicamente para
        los fines informados y proteger su confidencialidad. Cuando un tratamiento
        requiera consentimiento, este deberá ser informado y podrá retirarse, sin
        afectar el tratamiento realizado válidamente antes del retiro.
      </>,
    ],
  },
  {
    title: "13. Personas menores de edad",
    body: [
      <>
        mediasis Soporte está dirigido a personas adultas. No buscamos recopilar
        deliberadamente datos de menores de 18 años. Si una persona menor necesita
        utilizar el canal, debe hacerlo con el acompañamiento y autorización de su
        madre, padre o responsable legal.
      </>,
      <>
        Si sabemos que recibimos datos de una persona menor sin la autorización o
        acompañamiento correspondiente, tomaremos medidas razonables para
        eliminarlos. El responsable legal puede contactarnos en{" "}
        <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
      </>,
    ],
  },
  {
    title: "14. Cambios a esta política",
    body: [
      <>
        Podemos actualizar esta política para reflejar cambios legales, técnicos o
        en el servicio. Publicaremos la versión vigente en esta misma página y
        actualizaremos la fecha indicada al inicio.
      </>,
      <>
        Si el cambio es material, proporcionaremos un aviso destacado en el sitio
        web y, cuando corresponda, mediante WhatsApp antes de que el cambio entre
        en vigor.
      </>,
    ],
  },
];

export default function SupportPrivacyPolicyPage() {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top,_rgba(255,111,97,0.10),_transparent_32%),linear-gradient(to_bottom,_#fff,_#fff7f5)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image
              src="/mediasis-logo.png"
              alt="mediasis"
              width={132}
              height={52}
              priority
            />
          </Link>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/">Volver al inicio</Link>
          </Button>
        </div>

        <Card className="overflow-hidden rounded-[28px] border-zinc-200/80 bg-white/95 shadow-[0_24px_80px_rgba(0,0,0,0.06)] backdrop-blur">
          <CardHeader className="border-b border-zinc-100 bg-gradient-to-r from-[#fff4f1] via-white to-white px-6 py-8 md:px-10">
            <div className="inline-flex w-fit items-center rounded-full bg-[#ff6f61]/10 px-3 py-1 text-sm font-medium text-[#d55246]">
              Documento público · mediasis Soporte
            </div>
            <CardTitle className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 md:text-4xl">
              Política de Privacidad
            </CardTitle>
            <CardDescription className="max-w-3xl text-base leading-7 text-zinc-600">
              Esta política explica cómo tratamos la información recibida al
              brindar soporte por WhatsApp y Chatwoot.
            </CardDescription>
            <dl className="mt-3 flex flex-col gap-1 text-sm text-zinc-600 sm:flex-row sm:gap-6">
              <div className="flex gap-2">
                <dt className="font-medium text-zinc-900">Vigente desde:</dt>
                <dd>{effectiveDate}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium text-zinc-900">
                  Última actualización:
                </dt>
                <dd>{effectiveDate}</dd>
              </div>
            </dl>
          </CardHeader>

          <CardContent className="px-6 py-8 md:px-10">
            <div className="mb-10 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#d55246]">
                  Uso
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  Atención y resolución de solicitudes de soporte.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#d55246]">
                  Conservación
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  7 días después del cierre; backups hasta 3 meses.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#d55246]">
                  Control
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  Acceso, corrección, eliminación y retiro del consentimiento.
                </p>
              </div>
            </div>

            <div className="space-y-9">
              {sections.map((section) => (
                <section
                  key={section.title}
                  className={
                    section.title.includes("Eliminación de datos de WhatsApp")
                      ? "scroll-mt-6 rounded-3xl border border-[#ff6f61]/20 bg-[#fff7f5] px-5 py-6 md:px-6"
                      : "space-y-3"
                  }
                  id={
                    section.title.includes("Eliminación de datos de WhatsApp")
                      ? "eliminacion-datos-whatsapp"
                      : undefined
                  }
                >
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                    {section.title}
                  </h2>
                  <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-700 md:text-[15px] [&_a]:font-medium [&_a]:text-[#c7473b] [&_a]:underline [&_a]:underline-offset-4">
                    {section.body.map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}

              <section className="rounded-3xl border border-zinc-200 bg-zinc-50 px-5 py-5 text-sm leading-7 text-zinc-700 md:px-6">
                <h2 className="font-semibold text-zinc-950">Contacto</h2>
                <p className="mt-2">
                  mediasis · Cédula jurídica 3102952249 · Sabana, San José, Costa
                  Rica ·{" "}
                  <a
                    className="font-medium text-[#c7473b] underline underline-offset-4"
                    href={`mailto:${privacyEmail}`}
                  >
                    {privacyEmail}
                  </a>
                </p>
              </section>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
