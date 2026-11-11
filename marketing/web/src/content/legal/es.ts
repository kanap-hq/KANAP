import type { LegalContent } from './types';
import en from './en';

/* Traducción al español de la política de privacidad. La versión francesa
 * (fr.ts) es la que prevalece: todo cambio se hace primero en ese archivo y
 * después aquí. Solo se traduce la política de privacidad; los demás
 * documentos (terms, sales, legal) siguen siendo la versión inglesa.
 */

const content: LegalContent = {
  ...en,
  privacy: {
    meta: {
      title: 'Política de privacidad',
      description: 'Cómo KANAP recoge, utiliza y protege los datos personales conforme al RGPD.',
    },
    header: {
      eyebrow: 'Legal',
      title: 'Política de privacidad',
      lastUpdated: 'Última actualización: 11 de noviembre de 2026',
    },
    body: `
<h2>Preámbulo</h2>
<p>KANAP (en adelante, «KANAP»), SARL (sociedad de responsabilidad limitada) inscrita en el Registro Mercantil (RCS) de Saverne con el número 939 098 190, con domicilio social en 2, rue du Finhay, 67210 Obernai, Francia, concede la mayor importancia a la protección de tus datos personales. La presente política de privacidad (en adelante, la «Política») tiene por objeto informarte de forma clara y transparente sobre los tratamientos de datos personales que realiza KANAP en el marco del uso de la plataforma en línea de gestión informática «Kadratis» (en adelante, «la Plataforma»).</p>
<p>KANAP se compromete a cumplir el Reglamento General de Protección de Datos (RGPD) y la ley francesa n.º 78-17 de 6 de enero de 1978 relativa a la informática, los ficheros y las libertades, en su versión modificada.</p>

<h2>1. Responsable del tratamiento</h2>
<p>El responsable del tratamiento de los datos personales recogidos a través de la Plataforma es KANAP, SARL (sociedad de responsabilidad limitada) inscrita en el Registro Mercantil (RCS) de Saverne con el número 939 098 190, con domicilio social en 2, rue du Finhay, 67210 Obernai, Francia.</p>
<p>Para los datos que los clientes introducen en la Plataforma (datos presupuestarios, información financiera, datos de los usuarios dentro de los espacios de los clientes), la organización cliente actúa como responsable del tratamiento y KANAP como encargado del tratamiento.</p>

<h2>2. Datos personales recogidos</h2>
<p>KANAP recoge los siguientes datos personales de los usuarios de la Plataforma:</p>
<ul>
  <li><strong>Información de la cuenta:</strong> nombre, apellidos, dirección de email, cargo, nombre de la organización</li>
  <li><strong>Datos de autenticación:</strong> credenciales de acceso (las contraseñas se almacenan con hash y nunca en texto claro)</li>
  <li><strong>Datos de uso:</strong> registros de uso de la Plataforma, información de sesión, direcciones IP</li>
  <li><strong>Datos financieros:</strong> partidas presupuestarias, datos CAPEX/OPEX, información de reparto, detalles de los contratos introducidos por los usuarios</li>
  <li><strong>Información de facturación:</strong> razón social, dirección de facturación, número de IVA</li>
  <li><strong>Llamada de descubrimiento:</strong> si programas una, tu nombre, tu dirección de email, la fecha elegida y el mensaje opcional que dejes</li>
</ul>
<p>KANAP no conoce la información de pago (datos de la tarjeta bancaria). La trata directamente la plataforma de pago segura (Stripe).</p>

<h2>3. Finalidades del tratamiento</h2>
<ul>
  <li><strong>Prestación del servicio:</strong> los datos son necesarios para dar acceso a la Plataforma, gestionar las cuentas de usuario y prestar el servicio de gestión informática.</li>
  <li><strong>Mejora del servicio:</strong> los datos de uso sirven para mejorar la calidad y las funcionalidades del servicio, detectar problemas técnicos y optimizar el rendimiento.</li>
  <li><strong>Soporte al cliente:</strong> los datos sirven para responder a las solicitudes de los usuarios, prestar asistencia técnica y resolver problemas.</li>
  <li><strong>Facturación:</strong> los datos son necesarios para tramitar las suscripciones, emitir las facturas y gestionar los pagos.</li>
  <li><strong>Seguridad:</strong> los datos se tratan para garantizar la seguridad de la Plataforma y detectar y prevenir el fraude, los accesos no autorizados y los incidentes de seguridad.</li>
  <li><strong>Cumplimiento de las obligaciones legales:</strong> los datos se tratan para cumplir las obligaciones legales y reglamentarias.</li>
  <li><strong>Mensajes de la prueba:</strong> durante una prueba, tres mensajes de acompañamiento y el aviso de fin de la prueba. Cada mensaje contiene un enlace para darse de baja.</li>
  <li><strong>Llamada de descubrimiento:</strong> organizar la conversación que has solicitado.</li>
</ul>

<h2>4. Base jurídica del tratamiento</h2>
<ul>
  <li><strong>Ejecución del contrato:</strong> el tratamiento es necesario para prestar el servicio Kadratis (gestión de las cuentas, acceso a la Plataforma, etc.), incluidas las medidas tomadas a petición tuya antes de suscribirte (prueba, llamada de descubrimiento).</li>
  <li><strong>Interés legítimo:</strong> los tratamientos destinados a la mejora del servicio, la seguridad y la prevención del fraude se basan en el interés legítimo de KANAP en desarrollar y prestar un servicio de calidad y seguro, al igual que los mensajes de la prueba, de los que puedes darte de baja en cualquier momento.</li>
  <li><strong>Obligación legal:</strong> el tratamiento puede ser necesario para cumplir obligaciones legales (contables, fiscales, de lucha contra el blanqueo de capitales, etc.).</li>
  <li><strong>Consentimiento:</strong> para determinadas funcionalidades o comunicaciones opcionales, el tratamiento puede basarse en el consentimiento explícito del usuario.</li>
</ul>

<h2>5. Destinatarios de los datos</h2>
<p>KANAP puede compartir tus datos personales en los siguientes casos:</p>
<ul>
  <li><strong>Proveedores de servicios:</strong> KANAP puede recurrir a proveedores (alojamiento, infraestructura, procesamiento de pagos, servicios de email, etc.) que pueden acceder a datos personales en el marco de sus funciones. Estos proveedores están sujetos a obligaciones de confidencialidad y seguridad y actúan como encargados del tratamiento siguiendo las instrucciones de KANAP.</li>
  <li><strong>Obligaciones legales:</strong> KANAP puede estar obligada a comunicar datos personales a las autoridades administrativas o judiciales cuando la ley lo exija.</li>
</ul>
<p>KANAP se compromete a no compartir los datos personales de los usuarios con fines comerciales distintos de los mencionados anteriormente. KANAP nunca venderá ni alquilará tus datos personales a terceros.</p>
<p>Los proveedores (subencargados del tratamiento) que tratan datos personales por cuenta de KANAP en el marco del servicio en la nube son:</p>
<ul>
  <li><strong>Hetzner Online GmbH</strong> (Alemania): alojamiento de los servidores, de la base de datos y del almacenamiento de archivos.</li>
  <li><strong>Cloudflare</strong> (Estados Unidos): red, CDN y terminación TLS por delante de los servidores, con garantías contractuales para las transferencias fuera de la Unión Europea.</li>
  <li><strong>Resend</strong> (emails transaccionales, Estados Unidos): emails de activación de cuenta, de restablecimiento de contraseña, de notificación y mensajes de la prueba.</li>
  <li><strong>Stripe</strong> (pagos, Irlanda y Estados Unidos): procesamiento de pagos y facturación de las suscripciones.</li>
  <li><strong>Anthropic</strong> (Estados Unidos) o <strong>Mistral AI</strong> (Unión Europea), proveedor del modelo de IA integrado del servicio en la nube, según el que KANAP haya elegido y la aplicación indique: las funcionalidades de IA están desactivadas por defecto. El modelo integrado no recibe ningún dato mientras el espacio de trabajo no haya aceptado su proveedor y el lugar donde trata los datos, ambos indicados en la aplicación. Un administrador del espacio de trabajo da esta confirmación, que cubre el asistente, los agentes y los tratamientos programados. Se pide una nueva confirmación si cambia el proveedor o el lugar, y esta política se actualiza. KANAP solo elige un proveedor y una oferta cuyas condiciones excluyen el entrenamiento de sus modelos con los datos enviados. Los administradores pueden usar su propio proveedor de modelos en su lugar.</li>
  <li><strong>Cal.com</strong> (Estados Unidos): reserva de citas para las llamadas de descubrimiento.</li>
</ul>
<p>Los clientes que alojan Kadratis por su cuenta eligen sus propios proveedores, y KANAP no trata sus datos. Los clientes del servicio en la nube que conectan su propio proveedor de modelos de IA eligen ese proveedor, y KANAP no envía sus datos a su modelo integrado.</p>

<h2>6. Plazo de conservación de los datos</h2>
<ul>
  <li>Los datos de la cuenta y los datos que los clientes introducen en la Plataforma se conservan durante la vigencia del contrato. Al finalizar el contrato, se eliminan a petición del cliente.</li>
  <li>Un espacio de prueba sin suscripción se elimina definitivamente, con todos sus datos, treinta días después del fin de la prueba.</li>
  <li>Un registro cuyo enlace de activación nunca se ha usado se elimina a los 90 días.</li>
  <li>Los datos de una llamada de descubrimiento se conservan como máximo sesenta días después de la llamada.</li>
  <li>Los datos de facturación se conservan 10 años conforme a la normativa contable y fiscal francesa.</li>
  <li>KANAP no conserva los datos de pago, que gestiona directamente el proveedor de pagos (Stripe).</li>
</ul>

<h2>7. Seguridad de los datos</h2>
<ul>
  <li>HTTPS para todas las conexiones a la Plataforma</li>
  <li>Cifrado en reposo de los secretos y credenciales que almacena la Plataforma (AES-256-GCM)</li>
  <li>Control de acceso basado en roles y mecanismos de autenticación</li>
  <li>Alojamiento en la Unión Europea (Hetzner, Alemania)</li>
  <li>Hash de las contraseñas con algoritmos reconocidos (Argon2id)</li>
  <li>Aislamiento multiinquilino mediante seguridad a nivel de fila (Row-Level Security, RLS) en la base de datos</li>
  <li>Código fuente publicado bajo licencia AGPL v3, y un canal privado para notificar vulnerabilidades</li>
</ul>

<h2>8. Derechos de los usuarios</h2>
<p>Conforme al RGPD, dispones de los siguientes derechos sobre tus datos personales:</p>
<ul>
  <li>Derecho de acceso</li>
  <li>Derecho de rectificación</li>
  <li>Derecho de supresión</li>
  <li>Derecho a la limitación del tratamiento</li>
  <li>Derecho de oposición</li>
  <li>Derecho a la portabilidad de los datos</li>
  <li>Derecho a retirar tu consentimiento</li>
</ul>
<p>Para ejercer tus derechos, puedes contactar con KANAP en <a href="mailto:contact@kadratis.com">contact@kadratis.com</a>. También tienes derecho a presentar una reclamación ante la autoridad francesa de protección de datos (Commission nationale de l'informatique et des libertés, CNIL).</p>

<h2>9. Transferencias internacionales de datos</h2>
<p>La Plataforma está alojada en la Unión Europea, en Alemania. Algunos proveedores mencionados en la sección 5 pueden tratar datos personales fuera de la Unión Europea, por ejemplo Cloudflare para el tráfico de red. En ese caso, KANAP se asegura de que existan garantías adecuadas (el Marco de Privacidad de Datos UE-EE. UU. o cláusulas contractuales tipo).</p>

<h2>10. Cookies y tecnologías de seguimiento</h2>
<p>El sitio web kadratis.com no instala ninguna cookie publicitaria ni de medición de audiencia y no muestra banner de cookies. Medimos la audiencia con Cloudflare Web Analytics, que funciona sin cookies y sin almacenar nada en tu dispositivo. Los formularios de contacto y de prueba usan Cloudflare Turnstile, una comprobación de seguridad que distingue a las personas de los programas automatizados. El sitio recuerda en tu navegador tu elección de tema claro u oscuro, solo si eliges uno.</p>
<p>La aplicación usa únicamente las cookies necesarias para iniciar sesión y mantenerla. También almacena en tu navegador preferencias de interfaz, como tu tema y la disposición de las tablas. Puedes eliminarlas en cualquier momento en la configuración de tu navegador.</p>

<h2>11. Modificaciones de la política</h2>
<p>KANAP se reserva el derecho de modificar la presente Política en cualquier momento. Se informará a los usuarios de los cambios por cualquier medio, en particular mediante una notificación en la Plataforma o por email.</p>

<p class="mk-legal__foot">Para cualquier pregunta sobre esta política de privacidad, escribe a <a href="mailto:contact@kadratis.com">contact@kadratis.com</a>.</p>
`,
  },
};

export default content;
