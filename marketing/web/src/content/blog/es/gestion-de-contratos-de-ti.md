---
title: "La gestión de contratos de TI en KANAP"
description: "Plazos calculados, decisiones de renovación registradas, compromisos comparados con el presupuesto: los contratos de TI bajo control en KANAP."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: it-contract-management
series:
  key: opex-budget
  part: 6
  title: "Construir el presupuesto de TI"
---

¿A quién no se le ha pasado alguna vez el plazo de rescisión de un contrato? La negociación que sigue rara vez es agradable. Y es que no resulta fácil seguir decenas de plazos contractuales, contratos con renovación tácita o simplemente suscripciones. Esas fechas suelen estar en PDF firmados, en una hoja de cálculo o en manos de compras.

En KANAP, cada fecha se calcula a partir del contrato. Cada plazo llega al responsable adecuado, con tiempo para decidir. Y cada contrato se compara fácilmente con el presupuesto, lo que permite detectar las anomalías.

## La introducción de datos: unos pocos campos

Un contrato se crea en un único formulario. Cinco campos son obligatorios: el proveedor, la empresa firmante, la fecha de inicio, la duración de un periodo y la moneda. Después se añaden el responsable, la renovación tácita, el preaviso, el importe anual y la frecuencia de facturación.

KANAP calcula el resto: los periodos sucesivos, el plazo de rescisión de cada uno y la situación del contrato. Cambie la duración o el preaviso, y todas las fechas se ajustan.

En Fromage & Co, nuestra empresa de ejemplo, el mantenimiento de SAP cuesta 350.000 € al año. Va del 1 de julio al 30 de junio, con seis meses de preaviso y renovación tácita. KANAP calcula que puede rescindirse hasta el 30 de diciembre de 2026. Después de ese día, se renueva hasta junio de 2028.

La vista general del contrato lo dice en una frase: «Rescisión posible hasta el 30 dic 2026 · en 74 días». Una línea de tiempo muestra los periodos pasados, el periodo en curso y el próximo plazo. El periodo siguiente aparece en línea discontinua mientras todavía pueda evitarse. Una línea de datos recuerda desde cuándo se renueva el contrato.

![El contrato de mantenimiento de SAP de Fromage & Co: el próximo plazo de rescisión, la línea de tiempo de los periodos y el recuadro de decisión](/screenshots/blog/contracts-sap-overview-2026-10-17.png)

Un registro llevado en una hoja de cálculo se carga o se exporta como archivo CSV. La comprobación previa valida el archivo antes de guardar nada.

## La lista: lo que viene, en orden

La lista de contratos se ordena por **Próximo vencimiento**, el más cercano primero. Para un contrato con renovación tácita, es su próximo plazo de rescisión. Para los demás, su fin. Cada fecha va seguida de «en n días».

La columna **Situación** indica en qué punto está cada contrato:

- **Por decidir**: hay que tomar una decisión antes del plazo.
- **Termina sin renovación**: el contrato está en su último periodo.
- **Renovado el** una fecha: el preaviso ha pasado, el siguiente periodo es un hecho.
- **En curso**: todavía no vence nada.
- **Vencido**: el contrato ha terminado.

El filtro rápido **Por decidir en 90 días** aísla los contratos que necesitan una decisión. En Fromage & Co hay cuatro hoy: los servicios gestionados de TI en Estados Unidos (plazo 31 de octubre), Salesforce (28 de noviembre), SAP (30 de diciembre) y Okta (31 de diciembre). La ventana de 90 días se puede ajustar entre 0 y 365 días.

«Renovado el» muestra lo que ya está decidido. El acuerdo de Microsoft, la licencia de VMware y la red de Orange han superado su preaviso: empiezan un nuevo periodo el 1 de enero. Mejor saberlo mientras se prepara el presupuesto.

![La lista de contratos de Fromage & Co, filtrada por los contratos por decidir en 90 días](/screenshots/blog/contracts-to-decide-2026-10-17.png)

## La decisión: renovar, renegociar, rescindir

Más allá de la lista, KANAP pide al responsable que decida y deja constancia de la decisión.

Así, 90 días antes del plazo de rescisión (una ventana configurable), KANAP crea una tarea para cada contrato pendiente de decisión. Se asigna al responsable del contrato, con vencimiento en el plazo de rescisión. De ahí la importancia de que cada contrato tenga un responsable.

En la página del contrato, un recuadro indica lo que pasa si nadie actúa: «Sin decisión, el contrato se renovará por 12 meses el 1 jul 2027». El responsable elige entonces:

- **Renovar**: la renovación queda confirmada para este periodo y la tarea se cierra.
- **Renegociar**: la tarea sigue abierta hasta la decisión final y el recuadro indica «Renegociación en curso».
- **Rescindir**: KANAP propone el fin más temprano que permite el preaviso. Para el mantenimiento de SAP, es el 30 de junio de 2027. Una fecha anterior sigue siendo posible, con una advertencia: el proveedor tiene que aceptarla.

Antes de confirmar una rescisión, el recuadro enumera sus consecuencias: el compromiso del año y del siguiente, las aplicaciones que pierden este contrato, los activos que pierden su contrato de soporte. En el ejemplo de SAP, el compromiso de 2027 baja de 350.000 € a 175.000 € y el de 2028 cae a cero.

![El recuadro Rescindir del contrato de SAP: el fin más temprano que permite el preaviso y las consecuencias de la rescisión](/screenshots/blog/contracts-cancel-2026-10-17.png)

Cada decisión queda registrada: quién, cuándo y con qué justificación. Por ejemplo, «Renovación confirmada el 2 oct 2026 por Sophie Laurent». Una decisión tomada con demasiada prisa puede anularse mientras el plazo no haya pasado. Tras una rescisión, KANAP le recuerda que envíe la carta antes del plazo y que la adjunte al contrato.

## El contrato frente al presupuesto

El contrato dice lo que TI se ha comprometido a pagar. El presupuesto dice lo que ha previsto. KANAP compara ambos, año a año.

**Comprometido** es el importe anual del contrato repartido entre los meses que cubre un periodo, prorrateado por días. Para los años siguientes se supone que la renovación continúa hasta que se detenga. No hay nada comprometido después del fin del contrato.

**Presupuesto** suma las líneas presupuestarias vinculadas al contrato, para el año y la columna elegidos: el presupuesto, el aterrizaje previsto o el presupuesto del año siguiente en plena preparación. **Diferencia** es la resta, en naranja cuando falta presupuesto.

Cada contrato recibe una situación de cobertura: cubierto, infrapresupuestado, presupuesto por encima del contrato, sin línea presupuestaria, sin compromiso o presupuesto aún no iniciado. Dos filtros rápidos aíslan lo que requiere acción: **Sin línea presupuestaria** e **Infrapresupuestados**.

En el presupuesto 2026 de Fromage & Co, los contratos comprometen 3,73 M€. Tres de ellos no están vinculados a ninguna línea: el equipo nearshore de Lisboa, el equipo de comercio electrónico de Fromatech y la red de Orange, es decir 1,58 M€ de compromisos por enlazar con el presupuesto. En el aterrizaje previsto, cuatro contratos están infrapresupuestados, entre ellos el mantenimiento de SAP. A la inversa, el contrato de OVHcloud terminó en mayo y su línea todavía tiene presupuesto.

![La lista de contratos de Fromage & Co con las columnas Comprometido, Presupuesto y Diferencia del presupuesto 2026](/screenshots/blog/contracts-budget-coverage-2026-10-17.png)

El vínculo funciona en ambos sentidos. La pestaña Presupuesto del contrato muestra sus líneas y su cobertura en tres años. Una línea presupuestaria lleva a su contrato. ¡Una forma sencilla de evitar olvidos!

## Las cláusulas que debe contener un contrato

Un contrato cubre aplicaciones, y esas aplicaciones señalan cláusulas que debe contener. Los datos personales exigen un acuerdo de encargo del tratamiento conforme al RGPD y la ubicación de los datos. Una aplicación crítica exige una cláusula de reversibilidad, un plan de salida y un derecho de auditoría. La pestaña Conformidad del contrato enumera estos puntos según cómo se haya clasificado la aplicación. Cada uno se registra como presente, ausente o no aplicable, y el registro de conformidad se exporta en CSV. Volveremos sobre ello con más detalle en un próximo artículo.

## Lo que KANAP no hace

KANAP no redacta ni firma contratos y no lleva la negociación: eso es tarea de compras y del departamento jurídico. El importe a la firma se aplica a cada periodo: una indexación o una subida de precio se presupuesta en las líneas vinculadas. KANAP lleva el registro, los plazos, las decisiones y el vínculo con el presupuesto.

## Por dónde empezar

1. **Cargue el registro existente** desde un archivo CSV, tras la comprobación previa, o cree sus contratos a mano.
2. **Asigne un responsable a cada contrato**: recibirá las tareas de decisión.
3. **Vincule las líneas presupuestarias**, empezando por los contratos más grandes. Después revise Sin línea presupuestaria e Infrapresupuestados para el año que está preparando.
4. **Empiece la semana con Por decidir**: ningún plazo pasa sin decisión.

Para ver todo esto sobre contratos ya introducidos, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
