# Proceso de solicitud de acceso a SAP

El acceso a SAP S/4HANA se basa en roles. Toda solicitud pasa por ServiceNow en **IT > Access > SAP**: las solicitudes enviadas por correo a miembros concretos de TI se redirigen amablemente allí.

## Roles estándar

| Rol | Alcance | Aprobador |
|---|---|---|
| SAP FI (Finanzas) | Asientos contables, cierre, reporting | Maria Casanova (Finanzas y control de gestión) |
| SAP MM (Compras) | Pedidos de compra, recepción de mercancía | Responsable de Compras |
| SAP SD (Ventas) | Pedidos, entregas, facturación | Responsable de Ventas y marketing |
| SAP PP (Producción) | Órdenes de producción, registros de lotes | Jacques Dubois (Producción) |
| Solo visualización | Acceso de lectura a todos los módulos | Responsable directo |

## Cronología

- Solicitudes estándar: **2 días hábiles** tras la aprobación.
- **Vía urgente**: para el cierre mensual o una auditoría, el aprobador puede marcar la solicitud como *Urgente — cierre financiero*. Las solicitudes urgentes se atienden **el mismo día hábil** si se envían antes de las 15:00 CET.

## Nuevas incorporaciones

Envíe la solicitud **antes de la fecha de incorporación**: el alta en Workday por parte de RR. HH. crea automáticamente la cuenta Okta, pero los roles SAP siguen necesitando la solicitud en ServiceNow y su aprobación. Para un nuevo controller que deba contabilizar asientos desde el primer día, la solicitud debe enviarse la semana anterior, con la marca *Urgente — cierre financiero* si la incorporación cae en una semana de cierre.

## Segregación de funciones

El sistema bloquea las combinaciones que infringen las reglas de SoD (p. ej., crear proveedores *y* aprobar pagos). Si su solicitud se rechaza por SoD, Finanzas y control de gestión decide qué rol conserva. Sin excepciones, ni siquiera para emergencias queseras.
