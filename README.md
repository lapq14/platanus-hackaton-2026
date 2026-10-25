# Rastro

<img src="./project-logo.png" alt="Logo de Rastro" width="200" />

**Donaciones en custodia que se liberan por tramos, solo cuando la fundación demuestra en qué gastó.**

Proyecto del **team-28** para **Platanus Hack 26: Caracas ft. Yummy Project** · Track: 🤝 Trust

- Demo en producción: https://trazo-beryl.vercel.app
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

El dinero no llega completo de una vez. Queda en una **cuenta de custodia** y la fundación recibe solo un **tramo inicial que depende de su reputación**. El resto se libera cuando demuestra el gasto con factura y RIF del proveedor. Un **auditor** valida esas pruebas. Cada liberación es una transacción en blockchain que cualquiera puede verificar en el explorador.

### Actores

| Actor | Qué hace |
|---|---|
| **Donante** | Explora fundaciones y su reputación, dona desde un saldo y sigue cuánto de su aporte ya se liberó. Entra con Google, sin instalar ninguna wallet. |
| **Fundación (ONG)** | Recibe el tramo inicial según su reputación. Para desbloquear el resto sube la factura y el RIF del proveedor. |
| **Agente auditor** | Revisa la factura y el RIF. Si son válidos, libera el siguiente tramo. Si son sospechosos, suspende a la fundación y reembolsa al donante. |

### Flujo

1. El donante entra con Google. Privy crea su wallet automáticamente.
2. Elige una fundación y ve su reputación y el porcentaje que se libera al inicio.
3. Dona desde su saldo. La donación queda en custodia.
4. El sistema envía a la fundación el tramo inicial, como transacción real en la testnet.
5. La fundación gasta y sube factura y RIF.
6. El auditor resuelve:
   - **Aprobado:** sube la reputación y se libera el siguiente tramo.
   - **Sospechoso:** la fundación queda suspendida, se reembolsa al donante desde el fondo de reserva y se le avisa por correo.

### Reputación y porcentaje inicial

El porcentaje de liberación inicial se calcula en la base de datos a partir de la reputación (0 a 100):

| Reputación | Liberación inicial | Resto en custodia |
|---|---|---|
| 0 a 39 | 10% | 90% |
| 40 a 69 | 15% | 85% |
| 70 a 89 | 25% | 75% |
| 90 a 100 | 40% | 60% |

## Estado actual

| Funcionalidad | Estado |
|---|---|
| Catálogo de fundaciones con reputación, estado y porcentaje inicial | Hecho |
| Login con Google o correo, wallet embebida con Privy | Hecho |
| Saldo simulado en USD con recarga (50, 100 o 500) | Hecho |
| Donar desde el saldo, con alerta de fondos insuficientes | Hecho |
| Liberación inicial real on-chain desde la custodia a la fundación | Hecho |
| Reintento de liberación si la red falló | Hecho |
| Historial "Mis donaciones" con progreso de liberación y enlace al explorador | Hecho |
| Fundaciones suspendidas no aceptan donaciones | Hecho |
| Panel de la fundación: subir factura y RIF | Pendiente |
| Agente auditor con IA que valida factura y RIF | Pendiente |
| Liberación de tramos siguientes y ajuste de reputación | Pendiente |
| Suspensión, reembolso y correo de alerta al donante | Pendiente |
| Contrato en Solidity con score y hashes de verificación | Pendiente |

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
   │   y usan service role               donations, verifications
   ▼
Wallet de custodia (clave solo en el servidor)
   │
   ▼
Base Sepolia: liberación a la wallet de la fundación
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
  src/pages/            Home, detalle de fundación, mis donaciones
  src/components/       Modales de donación y recarga, layout, reputación
  src/context/          Usuario actual, saldo y wallet
  src/lib/              Configuración de red, variables, cliente de API
supabase/
  functions/            Edge Functions y código compartido
  migrations/           Cambios de esquema del saldo simulado
platanus-hack-project.jsonc   Metadatos para la votación
```

## Modelo de datos

| Tabla | Contenido clave |
|---|---|
| `users` | `wallet_address`, `email`, `privy_id`, `role` (donor, ong, auditor), `balance` en USD (máximo 10.000) |
| `foundations` | nombre, descripción, categoría, `reputation_score`, `payout_percentage`, `status` (active, suspended, under_review), `wallet_address`, `total_received` |
| `donations` | donante, fundación, `total_amount`, `amount_released`, `amount_refunded`, `status` (in_escrow, partially_released, completed, refunded), `release_tx_hash` |
| `verifications` | una fila por tramo: factura, RIF del proveedor, `status` (pending, approved, rejected), notas del auditor, hashes de liberación y reembolso |

Un trigger recalcula `payout_percentage` cada vez que cambia `reputation_score`. Existe además un bucket de Storage `invoices` para las facturas.

## Edge Functions

Todas se despliegan con `verify_jwt = false` porque reciben tokens de Privy, no de Supabase. Cada una verifica el token por su cuenta (ES256, `PRIVY_VERIFICATION_KEY` y `PRIVY_APP_ID`).

| Función | Qué hace |
|---|---|
| `sync-user` | Registra o actualiza al usuario de Privy en `users`. Nunca toca el saldo. |
| `wallet-topup` | Suma saldo simulado. El tope de 10.000 USD se aplica de forma atómica en la base de datos. |
| `donate` | Descuenta el saldo, registra la donación y libera el tramo inicial. Si la red falla tras el débito, responde 200 con liberación pendiente. |
| `release-initial` | Reintenta la liberación inicial. Solo el donante dueño de la donación puede llamarla. |
| `validate-registration` | Auditor IA del registro: valida el RIF (formato y dígito verificador en código, datos del documento con el modelo, duplicados) y pasa la fundación de `pending` a `active` (aceptada) o `rejected`. Si el modelo falla deja `pending` y se puede reintentar. Envía el resultado por correo (Resend). |

### Auditor del registro

Estados de `foundations.status`: `pending` (en revisión), `active` (aceptada/validada), `rejected` (con `rejection_reason`; puede reenviarse) y `frozen`. El documento RIF se sube al bucket privado `rif-docs` (entrada `{uuid}.ext`; la función lo mueve a `{foundation_id}/`). Los datos validados (RIF, razón social, tipo de contribuyente, domicilio fiscal, veredicto, checks) quedan en `foundation_verifications`, tabla solo accesible con service role; `verify-spend` los usa para comparar el RIF y el nombre de la fundación. Las pruebas del validador de RIF: `deno test supabase/functions/_shared/rif.test.ts`.

### Liberación inicial

La liberación es idempotente en cada paso: reserva la donación, envía la transacción, guarda el hash, espera el recibo y finaliza. Si se reintenta después de guardar el hash, solo finaliza y nunca envía dos veces. Si la transacción se revierte on-chain, la donación queda libre para un reintento limpio.

## Saldo simulado

Los donantes pagan desde un saldo simulado en USD, con tope de 10.000 por usuario. Solo la liberación de la custodia a la fundación es una transacción real en Base Sepolia, a la tasa `1 USD = 0.000001 ETH`. Antes de una demo hay que fondear la wallet de custodia con ETH de Base Sepolia.

## Seguridad

- Las columnas de saldo y las tablas `users` y `donations` solo se modifican desde el servidor, mediante funciones de Postgres accesibles únicamente con service role (`wallet_top_up`, `donate_from_balance`, `record_initial_release`).
- La clave privada de la custodia vive solo en los secretos de Supabase. Nunca va al navegador ni al repositorio.
- Las claves de Anthropic y Resend, cuando se usen, también serán secretos del servidor.
- Todo valor con prefijo `VITE_` queda visible en el navegador, por eso solo contiene datos públicos.

### Límites conocidos

- El servidor verifica solo la identidad de Privy. `wallet_address` y `email` que envía el cliente se guardan tal cual. Alguien podría registrar de antemano la wallet de otra persona, y el dueño real recibiría un error 409 `wallet_taken`.
- La política pública de inserción en `verifications` sigue abierta. Debe moverse detrás del flujo del auditor.
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
| `CHAIN_MODE` | Opcional (`simulated` por defecto; solo `real` envía transacciones en Base Sepolia) | - | - | Sí | Sí |
| `ANTHROPIC_API_KEY` | Sí (verificación de gastos con `verify-spend` y del registro con `validate-registration`) | - | - | Sí | Sí |
| `RESEND_API_KEY` | Opcional (correo de resultado del registro; sin ella no se envía y queda registrado como `skipped`) | - | - | Sí | Sí |
| `EMAIL_FROM` | Opcional (por defecto `Rastro <onboarding@resend.dev>`; usa un dominio verificado en Resend) | - | - | Sí | Sí |
| `APP_URL` | Opcional (URL pública del frontend, para el enlace al panel en el correo) | - | - | Sí | Sí |
| `SUPABASE_URL` | Solo local | - | - | Sí | No (se inyecta sola) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo local | - | - | Sí | No (se inyecta sola) |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan solas en las funciones alojadas y no deben cargarse como secretos.

El frontend valida sus variables al arrancar. Si falta una requerida, falla con un único error que lista todos los problemas. Los valores `VITE_*` se incrustan al compilar, así que hay que redesplegar tras cambiarlos.

## Despliegue

**Frontend en Vercel.** El proyecto usa `web/` como directorio raíz y `web/vercel.json` reescribe todas las rutas a `index.html`. Vercel solo puede conectarse a repositorios propios, por eso el despliegue sale del repositorio personal y cada `git push` se espeja al de la organización.

**Backend en Supabase.** Orden de despliegue:

1. Aplicar la migración A (`*_simulated_donor_balance_a.sql`).
2. Cargar los secretos de las funciones: `npx supabase secrets set CHAIN_ID=... CHAIN_RPC=... ESCROW_PRIVATE_KEY=... PRIVY_APP_ID=... PRIVY_VERIFICATION_KEY=... ANTHROPIC_API_KEY=... CHAIN_MODE=simulated`. `CHAIN_MODE` es opcional: sin definir (o con cualquier valor distinto de `real`) la cadena es simulada y no hace falta ETH.
3. Desplegar las funciones (incluida `validate-registration`, y `verify-spend` por el código compartido) y aplicar la migración `*_registration_audit.sql`. Opcional para el correo: `npx supabase secrets set RESEND_API_KEY=... EMAIL_FROM=... APP_URL=...`.
4. Aplicar la migración B (`*_simulated_donor_balance_b.sql`), que elimina las políticas públicas de inserción en `users` y `donations`.
5. Desplegar el frontend.

La clave de verificación de Privy se obtiene en Privy Dashboard, sección Configuration, App settings. En Privy hay que activar Google como método de login y agregar la URL de producción en Allowed origins.

## Próximos pasos

1. Panel de la fundación para subir factura y RIF al bucket `invoices`.
2. Edge Function del auditor que revisa la factura con un modelo con visión, valida el formato del RIF venezolano y decide aprobar o rechazar.
3. Liberación de los tramos siguientes y ajuste de reputación tras cada auditoría.
4. Suspensión, reembolso desde el fondo de reserva y correo de alerta con Resend.
5. Contrato en Solidity que registre el score de reputación y los hashes de verificación.
6. Cambiar la red a la testnet del hackatón.
