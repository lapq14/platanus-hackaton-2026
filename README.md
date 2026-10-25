# Rastro

<img src="./project-logo.png" alt="Logo de Rastro" width="200" />

**Donaciones en custodia que se liberan por tramos, solo cuando la fundación demuestra en qué gastó.**

Proyecto del **team-28** para **Platanus Hack 26: Caracas ft. Yummy Project** · Track: 🤝 Trust

- Demo en producción: https://rastro-beryl.vercel.app
- Red: Base Sepolia (testnet). Es provisional hasta tener los datos de la red del hackatón.

## Equipo

- Stephanie Sarai Salazar Saad ([@stepsita](https://github.com/stepsita))
- Luis Alejandro Petit Quintero ([@lapq14](https://github.com/lapq14))
- Sergio Andrés Silva Mayán ([@gioscore](https://github.com/gioscore))
- Diego Miguel Hidalgo Zorrilla ([@diegomhz](https://github.com/diegomhz))
- Nahomy Michelle Sanchez Martinez ([@nahomy1-dev](https://github.com/nahomy1-dev))

## El problema

Quien dona a una fundación rara vez sabe qué pasó con su dinero. Entregar el 100% de golpe obliga a confiar a ciegas, y un fraude se descubre cuando el dinero ya no está.

## La solución

El dinero no llega completo de una vez. Cada donación se divide en **tramos**. La fundación recibe de inmediato un **tramo inicial que depende de su nivel**, y el resto queda en una **cuenta de custodia** de la plataforma. Un tramo se desbloquea cuando la fundación demuestra, con facturas verificadas, que ya usó al menos la mitad del tramo anterior. Cada gasto queda atribuido a los aportes que lo pagaron, y cualquier persona puede ver ese rastro sin registrarse.

### Actores

| Actor | Qué hace |
|---|---|
| **Donante** | Explora fundaciones, dona desde un saldo y sigue su aporte tramo por tramo: cuánto se entregó, en qué se usó cada parte y qué sigue en custodia. Entra con Google, sin instalar ninguna wallet. |
| **Fundación (ONG)** | Recibe el tramo inicial según su nivel. Reporta sus gastos con factura y los documentos de las cuentas, hasta el monto que ya recibió y no ha gastado. |
| **Agente auditor** | Un agente con IA verifica la cuenta de origen, la cuenta de destino y el RIF del proveedor contra el registro de negocios. Si todo cuadra, el gasto se verifica. Si no, la fundación se congela y los donantes reciben su dinero de vuelta. |
| **Cualquier persona** | Ve el rastro público de una fundación: gastos, facturas, proveedores y qué aportes los pagaron, sin datos personales de los donantes. |

### Flujo

1. El donante entra con Google. Privy crea su wallet automáticamente.
2. Elige una fundación y ve su nivel y el porcentaje que se entrega al inicio.
3. Dona desde su saldo. La donación se divide en tramos y el tramo inicial se transfiere a la fundación.
4. La fundación reporta un gasto, hasta lo que tiene disponible. El agente lo verifica.
5. Si se verifica, el gasto **consume los tramos entregados en una cola**: primero la donación más antigua y, dentro de ella, el tramo más bajo. Lo que sobra de un tramo queda ahí para el siguiente gasto.
6. Cuando un tramo llega al 50% usado, se desbloquea el siguiente tramo de esa misma donación y se transfiere a la fundación.
7. Si el agente rechaza el gasto, la fundación se congela y se reembolsa a los donantes.

### Niveles de reputación

El nivel sale de la reputación (0 a 100) y define cuánto se entrega al donar y en cuántos tramos se divide la donación. Se calcula en la base de datos.

| Nivel | Reputación | Entrega inicial | Tramos | Reparto de $100 |
|---|---|---|---|---|
| 1 | 0 a 29 | 25% | 4 | 25, 25, 25, 25 |
| 2 | 30 a 49 | 30% | 4 | 30, 23,33, 23,33, 23,34 |
| 3 | 50 a 69 | 40% | 4 | 40, 20, 20, 20 |
| 4 | 70 a 89 | 45% | 4 | 45, 18,33, 18,33, 18,34 |
| 5 | 90 a 100 | 50% | 3 | 50, 25, 25 |

El primer tramo es la entrega inicial. El resto se reparte en partes iguales y el último absorbe el redondeo. Cada gasto verificado suma 4 puntos de reputación.

**Sin historial no es inconfiable.** Una fundación que nunca participó en una recaudación no tiene información, y se muestra como "Sin historial" en un tono neutro. Solo se marca "Inconfiable" cuando, ya dentro de una recaudación, las cosas no cuadran: queda congelada o tiene una factura rechazada o con observaciones.

| Estado | Cuándo |
|---|---|
| Sin historial | No ha recibido dinero, donaciones ni facturas resueltas |
| En construcción | Tiene historial, sin incidentes y reputación menor a 70 |
| Confiable | Reputación de 70 o más y sin incidentes |
| Inconfiable | Congelada, o con una factura rechazada o con observaciones |

**Una fundación inconfiable baja a nivel 1.** Una regla en la base de datos reconoce el momento en que una fundación pasa a ser inconfiable y le limita la reputación a 1, que es el nivel 1. Se activa al congelarla, al rechazar uno de sus gastos y al verificar un gasto con observaciones. Mientras siga inconfiable, ningún aumento de reputación la saca del nivel 1. Su ficha muestra una alerta por cada incidente.

La pantalla de inicio solo muestra fundaciones de nivel 3 en adelante, con historial y sin alertas, en una línea por nivel. Explorar muestra todas.

### Cómo se atribuye un gasto

Un ejemplo con una donación de $100 en nivel 3, o sea tramos de 40, 20, 20 y 20:

| Gasto | Consumo | Estado tras el gasto | Desbloqueo |
|---|---|---|---|
| $30 | Tramo 1: $30 de 40 | Tramo 1 al 75% | Tramo 2 de $20 |
| $25 | Tramo 1: $10, tramo 2: $15 | Tramo 1 agotado, tramo 2 al 75% | Tramo 3 de $20 |

Reglas:

- Un gasto nunca puede superar el saldo disponible de la fundación, que es lo entregado y aún no gastado, menos lo que otras facturas en revisión ya reservan.
- Se desbloquea un solo tramo por donación y por gasto. Los desbloqueos no se encadenan.
- Si hay varios aportes, el último puede cubrirse solo en parte. El resto queda disponible para el siguiente gasto.
- Cada trozo consumido se guarda en `tranche_uses`, y de ahí sale el rastro del donante y el rastro público.

## Estado actual

| Funcionalidad | Estado |
|---|---|
| Catálogo de fundaciones con nivel, reputación y estado | Hecho |
| Login con Google o correo, wallet embebida con Privy | Hecho |
| Saldo simulado en USD con recarga (50, 100 o 500) | Hecho |
| Donar desde el saldo, con tramos según el nivel | Hecho |
| Entrega inicial real on-chain desde la custodia a la fundación | Hecho |
| Registro de fundaciones y panel de la fundación | Hecho |
| Reporte de gastos con facturas y documentos, validado contra el saldo disponible | Hecho |
| Agente auditor con IA que verifica cuentas y RIF contra el registro de negocios | Hecho |
| Cola de gastos: atribución a los aportes más antiguos primero | Hecho |
| Desbloqueo del siguiente tramo al llegar al 50% usado | Hecho |
| Rastro del donante con fecha, uso de cada tramo, proveedor y progreso al 50% | Hecho |
| Rastro público de cada fundación, sin registro y sin datos personales | Hecho |
| Congelamiento y reembolso al saldo cuando se rechaza un gasto | Hecho |
| Perfil editable de la fundación: descripción, logo, redes y wallet de cobro | Hecho |
| Vista de fondos de la fundación: aportes, uso por tramo y avance al 50% | Hecho |
| Reintento de documentos: hasta 3 verificaciones y 7 días con el gasto abierto | Hecho |
| Gasto sin respaldo tras 7 días: sospechoso y nivel 1 | Hecho |
| Apelación de una fundación congelada o inconfiable | Se recibe, la resuelve soporte técnico |
| Subida de archivos controlada por el servidor | Hecho |
| Reclamo de fundaciones del catálogo con un código de un solo uso | Hecho |
| Consola del auditor humano | Solo interfaz |
| Correo de alerta al donante tras un reembolso | Pendiente |
| Contrato en Solidity con score y hashes de verificación | Pendiente |
| Cambiar a la testnet del hackatón | Pendiente |

## Arquitectura

```
Navegador (React + Vite)
   │  login con Google
   ▼
Privy ──► access token (ES256)
   │
   ▼  Authorization: Bearer <token de Privy>
Supabase Edge Functions (Deno)  ──►  Postgres (Supabase)
   │   verifican el token de Privy       users, foundations,
   │   y usan service role               donations, tranches,
   │                                     tranche_uses, invoices
   ▼
Wallet de custodia (clave solo en el servidor)
   │
   ▼
Base Sepolia: entrega a la wallet de la fundación
```

### Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS 4, React Router, lucide-react |
| Autenticación y wallets | Privy (`@privy-io/react-auth`), wallet embebida no custodial |
| Backend y base de datos | Supabase: Postgres, Edge Functions, Storage |
| Blockchain | Base Sepolia, cliente `viem` |
| Hosting | Vercel (raíz del proyecto en `web/`) |

### Estructura del repositorio

```
web/                    Frontend (Vite + React)
  src/pages/            Home, fundación y rastro público, mis rastros, panel
  src/components/       Rastro público, línea de tiempo de tramos, reputación
  src/context/          Usuario actual, saldo y wallet
  src/lib/              Configuración de red, variables, cliente de API
supabase/
  functions/            Edge Functions y código compartido
  migrations/           Esquema: saldo simulado, cola de tramos y privacidad
platanus-hack-project.jsonc   Metadatos para la votación
```

## Modelo de datos

| Tabla | Contenido clave |
|---|---|
| `users` | `wallet_address`, `email`, `privy_id`, `role` (donor, ong, auditor), `balance` en USD (máximo 10.000) |
| `foundations` | datos públicos, `reputation_score`, `level` (1 a 5), `payout_percentage`, `status` (active, pending, frozen), `wallet_address`, `total_received`. El correo oficial y los documentos legales son privados |
| `donations` | donante, fundación, `total_amount`, `initial_pct`, `tranche_count`, `status` (in_escrow, partially_released, completed, refunded), hashes de transferencia |
| `tranches` | un tramo de una donación: `index`, `amount`, `state` (in_custody, in_review, released, broken), `remaining` (lo que aún se puede gastar), `invoice_id` (el gasto que lo desbloqueó) |
| `tranche_uses` | cada pedazo de un tramo consumido por un gasto verificado: tramo, factura y monto. Es el rastro |
| `invoices` | gastos reportados: concepto, monto, RIF del proveedor, documentos, verificaciones del agente, `allocated_amount` |
| `refunds` | reembolsos por congelamiento |
| `businesses`, `business_accounts` | registro de negocios y sus cuentas, contra el que el agente verifica |

Estado de un tramo: `in_custody` lo retiene la plataforma, `in_review` cumplió la condición y su transferencia está en curso, `released` ya es de la fundación y tiene saldo gastable, `broken` nunca se entregó porque la donación se reembolsó.

Vistas públicas:

- `foundation_stats`: dinero entregado, en custodia, gastado y disponible, conteos de facturas y el estado de reputación.
- `invoices_public`: facturas sin rutas de archivos, sin documentos de cuentas y sin el detalle de las verificaciones.

## Edge Functions

Todas se despliegan con `verify_jwt = false` porque reciben tokens de Privy, no de Supabase. Las que requieren sesión verifican el token por su cuenta (ES256, `PRIVY_VERIFICATION_KEY` y `PRIVY_APP_ID`).

| Función | Sesión | Qué hace |
|---|---|---|
| `sync-user` | Sí | Registra o actualiza al usuario de Privy en `users`. Nunca toca el saldo. |
| `wallet-topup` | Sí | Suma saldo simulado. El tope de 10.000 USD se aplica de forma atómica en la base de datos. |
| `donate` | Sí | Descuenta el saldo, crea la donación con sus tramos y transfiere el tramo inicial. |
| `release-initial` | Sí | Reintenta la entrega inicial. Solo el donante dueño de la donación puede llamarla. |
| `my-donations` | Sí | Donaciones del donante con cada tramo, sus usos y las facturas asociadas. Para la fundación, las donaciones recibidas con un alias del donante. |
| `register-foundation` | Sí | Crea la fundación del usuario y le da el rol de organización. |
| `report-spend` | Sí | Crea un gasto en revisión y rechaza uno que supere el saldo disponible. |
| `verify-spend` | Sí | Verifica el gasto con el agente. Si pasa, lo atribuye a los aportes y desbloquea tramos. Si no, congela y reembolsa. |
| `upload-url` | Sí | Entrega una URL firmada de subida bajo la carpeta de la fundación. Limita tipo, tamaño y cantidad de archivos sin usar. |
| `foundation-me` | Sí | Perfil privado de la fundación propia, sus estadísticas y sus apelaciones. |
| `update-profile` | Sí | Edita descripción, categoría, ubicación, redes, logo y wallet de cobro. El nombre y el RIF no se editan. |
| `foundation-funds` | Sí | Aportes recibidos, uso de cada tramo y próximos desbloqueos con el gasto que falta. |
| `foundation-invoices` | Sí | Facturas propias con el detalle de cada verificación, los intentos y el plazo. |
| `submit-appeal` | Sí | Registra una apelación. Queda en estado recibida a la espera de soporte técnico. |
| `claim-foundation` | Sí | Canjea un código de un solo uso para administrar una fundación del catálogo. |
| `document-url` | Opcional | URL firmada de 60 segundos. Las facturas verificadas son públicas. Todo lo demás exige ser la fundación dueña o un auditor. |
| `foundation-trace` | No | Rastro público de una fundación: gastos, quién los pagó y todos los aportes con sus tramos. |

### Respaldo de gastos y apelaciones

- Un gasto reportado queda abierto con un plazo de 7 días para respaldarlo con documentos válidos.
- Cada verificación fallida deja el gasto abierto y cuenta como un intento. El tercer fallo lo rechaza: congela la fundación y reembolsa el 100%.
- El cambio de documentos reemplaza solo lo que se vuelve a subir. El resto se conserva y los archivos reemplazados se borran.
- Un gasto abierto después del plazo se marca como sospechoso. La fundación pasa a inconfiable y su nivel baja a 1. Un respaldo tardío válido lo levanta. Una tarea programada revisa los plazos cada 15 minutos.
- Los gastos anteriores a esta regla no tienen plazo.
- Una fundación congelada o inconfiable puede enviar una apelación con texto y hasta 3 archivos. Solo se registra. Revisarla requiere intervención manual de soporte técnico.

### Entrega inicial y desbloqueos

Ambas transferencias son idempotentes en cada paso: reservan, envían, guardan el hash, esperan el recibo y finalizan. Si se reintenta después de guardar el hash, solo finalizan y nunca envían dos veces. Si la transacción se revierte, queda libre para un reintento limpio. Un gasto envía una sola transferencia por todo lo que desbloqueó.

## Saldo simulado

Los donantes pagan desde un saldo simulado en USD, con tope de 10.000 por usuario. Solo la entrega de la custodia a la fundación es una transacción de red, a la tasa `1 USD = 0.000001 ETH`. Por defecto la red es simulada y genera hashes con un marcador "Simulado". Con `CHAIN_MODE=real` se envían transacciones en Base Sepolia y hay que fondear la wallet de custodia.

## Seguridad y privacidad

- Las tablas con datos personales o de dinero (`users`, `donations`, `tranches`, `tranche_uses`, `invoices`, `refunds`, `verifications`) están cerradas a la clave pública. Solo se leen mediante funciones con identidad verificada o mediante las vistas públicas.
- De `foundations` solo se leen las columnas públicas. El correo oficial y los documentos legales quedan fuera.
- El bucket `invoices` es privado. Los documentos se abren con URLs firmadas que emite `document-url`. Los documentos de cuentas bancarias nunca son públicos.
- El rastro público identifica los aportes con un código corto, sin nombre, correo ni wallet del donante.
- Los saldos y las donaciones solo se modifican desde el servidor, con funciones de Postgres accesibles únicamente con service role.
- Nadie escribe en el almacenamiento de forma directa. Los archivos se suben con URLs firmadas que emite `upload-url`, bajo la carpeta de la fundación. Cada archivo debe ser reclamado por un gasto, una apelación o el logo. Los que nadie reclama en 24 horas se borran.
- Una fundación del catálogo se asigna con un código de un solo uso, con vencimiento y límite de 5 intentos fallidos por hora. Solo se guarda su hash. No se usa el correo para asignarla porque el servidor no verifica el correo que envía el cliente.
- La clave privada de la custodia y las claves de Anthropic y Resend viven solo en los secretos de Supabase. Todo valor con prefijo `VITE_` queda visible en el navegador, por eso solo contiene datos públicos.

### Límites conocidos

- El servidor verifica solo la identidad de Privy. `wallet_address` y `email` que envía el cliente se guardan tal cual. Alguien podría registrar de antemano la wallet de otra persona, y el dueño real recibiría un error 409 `wallet_taken`.
- Si se reembolsa, la plataforma absorbe lo ya entregado a la fundación. Esa exposición llega al 50% de cada donación en el nivel 5.
- Los gastos en revisión anteriores a esta versión que superan el saldo disponible no se pueden verificar hasta que la fundación reciba más aportes.
- El saldo simulado no se puede retirar y no hay recargas de administrador.
- La red es una testnet provisional, no la del hackatón.

## Ejecutar en local

Requisitos: Node 22 o superior.

```bash
cd web
npm install
cp .env.example .env.local   # completar VITE_PRIVY_APP_ID
npm run dev                  # http://localhost:5173
```

Otros comandos del frontend: `npm run build`, `npm run lint`, `npm run preview`.

### Funciones en local

```bash
npx supabase functions serve --env-file supabase/functions/.env.local
```

Si no existe `supabase/config.toml`, ejecutar antes `npx supabase init`.

## Variables de entorno

Cada paquete tiene su propio archivo. No hay `.env` en la raíz. Las plantillas están en `web/.env.example` y `supabase/functions/.env.example`. Los valores reales nunca se versionan.

| Variable | Requerida | Web local (`web/.env.local`) | Vercel | Edge local (`supabase/functions/.env.local`) | Secretos de Supabase |
|---|---|---|---|---|---|
| `VITE_PRIVY_APP_ID` | Sí | Sí | Sí | - | - |
| `VITE_SUPABASE_URL` | Sí | Sí | Sí | - | - |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sí | Sí | Sí | - | - |
| `VITE_ESCROW_ADDRESS` | Opcional (heredada, sin uso) | Sí | Sí | - | - |
| `VITE_CHAIN_ID` | Opcional (84532) | Sí | Sí | - | - |
| `VITE_CHAIN_NAME` | Opcional (Base Sepolia) | Sí | Sí | - | - |
| `VITE_CHAIN_SYMBOL` | Opcional (ETH) | Sí | Sí | - | - |
| `VITE_CHAIN_RPC` | Opcional (https://sepolia.base.org) | Sí | Sí | - | - |
| `VITE_CHAIN_EXPLORER` | Opcional (https://sepolia.basescan.org) | Sí | Sí | - | - |
| `ESCROW_PRIVATE_KEY` | Sí | - | - | Sí | Sí |
| `PRIVY_APP_ID` | Sí | - | - | Sí | Sí |
| `PRIVY_VERIFICATION_KEY` | Sí (PEM, saltos de línea como `\n` literal) | - | - | Sí | Sí |
| `CHAIN_ID` | Opcional (84532) | - | - | Sí | Sí |
| `CHAIN_RPC` | Opcional (https://sepolia.base.org) | - | - | Sí | Sí |
| `SUPABASE_URL` | Solo local | - | - | Sí | No (se inyecta sola) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo local | - | - | Sí | No (se inyecta sola) |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan solas en las funciones alojadas y no deben cargarse como secretos.

El frontend valida sus variables al arrancar. Si falta una requerida, falla con un único error que lista todos los problemas. Los valores `VITE_*` se incrustan al compilar, así que hay que redesplegar tras cambiarlos.

## Despliegue

**Frontend en Vercel.** El proyecto usa `web/` como directorio raíz y `web/vercel.json` reescribe todas las rutas a `index.html`. Vercel solo puede conectarse a repositorios propios, por eso el despliegue sale del repositorio personal y cada `git push` se espeja al de la organización.

**Backend en Supabase.** Orden de despliegue:

1. Cargar los secretos de las funciones: `npx supabase secrets set CHAIN_ID=... CHAIN_RPC=... ESCROW_PRIVATE_KEY=... PRIVY_APP_ID=... PRIVY_VERIFICATION_KEY=... ANTHROPIC_API_KEY=...`
2. Aplicar las migraciones en orden. La última, `*_tranche_queue.sql`, introduce los cinco niveles y la cola de tramos, migra los datos existentes y cierra la lectura pública de las tablas privadas.
3. Desplegar todas las funciones de `supabase/functions`.
4. Desplegar el frontend. La migración de privacidad deja de servir `foundations`, `invoices` y `donations` por la clave pública, así que el frontend viejo deja de funcionar y conviene desplegarlo enseguida.

La clave de verificación de Privy se obtiene en Privy Dashboard, sección Configuration, App settings. En Privy hay que activar Google como método de login y agregar la URL de producción en Allowed origins.

## Próximos pasos

1. Correo de alerta al donante cuando se reembolsa su donación (Resend).
2. Que la consola del auditor humano ejecute decisiones reales, además del agente.
3. Contrato en Solidity que registre el score de reputación y los hashes de verificación.
4. Cambiar la red a la testnet del hackatón.
5. Resolución de apelaciones por soporte técnico, con su propio panel.
6. Una cola más justa para los aportes recientes, cuyo siguiente tramo tarda más en desbloquearse.
