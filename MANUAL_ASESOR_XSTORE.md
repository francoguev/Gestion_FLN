# 📱 Guía de Capacitación para el Asesor · Gestión Xstore

Bienvenido al manual operativo de **Gestión Xstore**. En esta guía aprenderás paso a paso cómo declarar la caja diaria de tu tienda (PDV), desglosar ventas con **PayJoy**, registrar comprobantes bancarios (vouchers), hacer depósitos parciales o con sobrantes, y realizar el seguimiento de tus validaciones.

---

## 🎯 1. Objetivo del Módulo
Garantizar la **transparencia y cuadre exacto** entre el dinero reportado en el sistema Xstore de la tienda, el efectivo real depositado en la cuenta bancaria de la empresa y la devolución pendiente de PayJoy.

---

## 📝 Paso a Paso 1: Registro Diario de Recaudo de Caja

El registro de recaudo se realiza al finalizar la jornada o al iniciar el turno siguiente.

### 📍 Pasos para registrar:
1. Haz clic en el botón **`+ Registrar recaudo`** en la parte superior.
2. Selecciona la **Fecha de caja** (por defecto es el día de hoy).
3. **Monto recaudado (Sistema Xstore)**: Digita el valor exacto que figura en el reporte final de caja de tu sistema Xstore (incluye contado, financiado y PayJoy).
4. **Foto de evidencia de caja**: Adjunta una foto clara del reporte físico o pantalla de caja.

> **Regla de Negocio PayJoy**:
> La caja Xstore registra las ventas PayJoy por el costo total del equipo como si fuera efectivo contado. Sin embargo, el cliente solo deja una **Inicial en efectivo** en tienda. Por lo tanto, el efectivo real en caja es **menor al reportado en Xstore**.

### 📱 ¿Cómo registrar un equipo PayJoy?
Si vendiste equipos financiados por PayJoy durante el día:
1. En el formulario, haz clic en **`+ Agregar equipo PayJoy`**.
2. Digita el **Costo del equipo** y la **Inicial pagada por el cliente**.
3. Repite este paso si vendiste 2 o más equipos.
4. **Calculadora en vivo**: El sistema calculará automáticamente:
   - **Devolución por cobrar a PayJoy** = Suma(Costo - Inicial)
   - **Efectivo Real a Depositar en Banco** = Recaudo Sistema - PayJoy

> **Ejemplo Práctico**:
> Si tu caja Xstore marca **S/ 1,000.00** y vendiste 2 equipos PayJoy (Costo S/ 100 c/u e inicial pagada de S/ 10 c/u):
> - *PayJoy a devolver a la empresa*: `S/ 180.00` (S/ 90 por cada equipo).
> - *Efectivo Real que debes depositar en el banco*: `S/ 820.00`.

### 🔒 ¿Qué hacer si la tienda NO abrió?
1. Marca la casilla **`La tienda no abrió este día`**.
2. El monto se fijará automáticamente en `S/ 0.00` y no se exigirá foto de evidencia.
3. Escribe brevemente el motivo en el campo *Motivo de cierre* (ej. *Feriado local*, *Mantenimiento*).

---

## 🏦 Paso a Paso 2: Registro de Depósitos Bancarios (Vouchers)

Una vez que realizas el depósito en la cuenta del banco, debes registrar el comprobante.

### 📍 Pasos para registrar el depósito:
1. Haz clic en **`+ Registrar depósito`**.
2. Ingresa la **Fecha del depósito** (según figura en el comprobante bancario).
3. Adjunta la **Foto del voucher de depósito**.
4. **Seleccionar días a cubrir**: En la lista inferior aparecerán los días pendientes de tu tienda. Marca la casilla del día o días que estás pagando.

---

### ✌️ Casos Especiales en Depósitos

#### A. Depósitos en 2 o más partes (Abonos Parciales)
Si realizaste un depósito grande y tuviste que ir al banco 2 o más veces:
1. Al registrar la **primera parte**, selecciona la fecha de caja.
2. En el recuadro del monto, **modifica la cifra y digita solo el pago parcial** que hiciste (ej. `S/ 500.00` de un pendiente de `S/ 1,200.00`).
3. Adjunta la foto del 1er voucher y guarda.
4. El día se mantendrá activo mostrando el saldo restante (`S/ 700.00`).
5. Cuando tengas el 2do voucher, vuelve a **Registrar depósito**, selecciona la misma fecha y adjunta el 2do comprobante por la diferencia.

#### B. Depósitos con Sobrante (Factor Humano)
Si por redondeo, cambio acumulado o error en ventanilla del banco depositaste **más dinero del que requería la caja**:
1. Digita el monto real depositado según el voucher (ej. `S/ 850.00` para un requerido de `S/ 820.00`).
2. El sistema **no te bloqueará** y guardará el depósito.
3. En tu tabla de seguimiento aparecerá el indicador destacado: **`+ S/ 30.00 Sobrante`** en color verde.

---

## ✏️ Paso a Paso 3: Edición y Correcciones por el Asesor

### ¿Cuándo puedes editar un recaudo?
- Siempre puedes presionar el botón **`Editar recaudo`** por día mientras la caja se encuentre en estado **Pendiente de depósito** o **Observar y devolver**.
- Si cometiste un error en la cifra de caja Xstore al registrar el día, presiona **`Editar recaudo`**, corrige el monto, escribe el motivo y guarda.

---

## 📊 Paso a Paso 4: Lectura de la Tabla de Seguimiento Diario

La tabla te muestra el estado en tiempo real de tu tienda:

| Columna | Significado |
| :--- | :--- |
| **Fecha** | Día calendario correspondencia a la caja. |
| **Recaudo Sistema** | Monto bruto reportado en el reporte Xstore. |
| **PayJoy Por Cobrar** | Importe a devolver por PayJoy (resaltado con insignia). |
| **Efectivo a Depositar** | Efectivo real requerido en banco (`Sistema - PayJoy`). |
| **Depositado** | Suma total acumulada de tus vouchers para esta fecha. |
| **Pendiente Banco** | Saldo que falta depositar (o `+ S/ XX Sobrante` en verde). |
| **Estado** | Estado del flujo (*Pendiente depósito*, *En revisión*, *Cuadrado*, etc.). |
| **Acciones** | Botones para ver **Caja**, **Voucher(s)** y **Editar recaudo**. |

---

## ❓ Sección Q&A · Preguntas Frecuentes

### Q1: Vendo un equipo PayJoy de S/ 900 con una inicial de S/ 100 en efectivo. ¿Cómo lo registro?
**R:** En *Monto recaudado (Sistema Xstore)* colocas el valor total que indica tu reporte Xstore. Luego agregas 1 equipo PayJoy con Costo `900` e Inicial `100`. El sistema sabrá que PayJoy debe devolver `S/ 800` a la empresa y que tú solo debes depositar en banco `Recaudo Xstore - S/ 800`.

### Q2: Depositamos en el banco el monto de 2 días juntos en un solo voucher. ¿Se puede?
**R:** **Sí.** Al abrir *Registrar depósito*, digitas el monto total del voucher y marcas los checkboxes de los 2 días correspondientes. El sistema distribuirá el voucher en ambas fechas.

### Q3: Deposité S/ 20.00 de más en el banco por error. ¿El sistema me dejará guardar el voucher?
**R:** **Sí.** El sistema permite ingresar el monto real del voucher y mostrará en la tabla un estado de **`+ S/ 20.00 Sobrante`** en verde, el cual será auditado y validado por Operaciones.

### Q4: Hice un abono parcial y ahora tengo 2 fotos de vouchers para la misma fecha. ¿Dónde las veo?
**R:** En la tabla de seguimiento, en la columna *Acciones*, verás el botón **`Vouchers (2)`**. Al hacer clic se abrirán los comprobantes adjuntos correspondientes a esa fecha.

### Q5: ¿Qué significa si mi caja cambia al estado "Observar y devolver"?
**R:** Significa que Operaciones detectó una inconsistencia entre el reporte de caja y los vouchers adjuntos. Lee la nota dejada por Operaciones, presiona el botón **`Editar recaudo`** o ponte en contacto con tu supervisor para regularizar la diferencia.

---

> 🏢 **Gestión Xstore — Sistema Pulso**  
> *Plataforma oficial de control de recaudos y depósitos bancarios para tiendas.*
