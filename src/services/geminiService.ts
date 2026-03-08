import { GoogleGenAI, Type } from "@google/genai";
import { DailySummary } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function analyzeDailyPerformance(summary: DailySummary) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Actúa como un analista financiero experto para un salón de belleza.
    Analiza el rendimiento del día con los siguientes datos:
    Fecha: ${summary.date}
    Venta Neta: ${summary.netSales}
    IVA: ${summary.iva}
    Venta Total: ${summary.totalSales}
    Comisiones Pagadas: ${summary.commissionsPaid}
    Gastos Diarios (incluyendo prorrateo de fijos): ${summary.dailyExpenses}
    Utilidad del Día: ${summary.profit}

    Genera un análisis estructurado en JSON con:
    - aspectos positivos (lista)
    - aspectos a mejorar (lista)
    - alertas de rentabilidad (lista)
    - consejos para aumentar ventas o mejorar margen (lista)
    - un resumen ejecutivo breve.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          positives: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          alerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          tips: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING }
        },
        required: ["positives", "improvements", "alerts", "tips", "summary"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function parseReceipt(base64Data: string, mimeType: string = "image/png", knownProfessional?: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Extrae la información de esta boleta de Fresha (salón de belleza).
    El archivo puede ser una imagen o un PDF.
    ${knownProfessional ? `SABEMOS que el profesional es: ${knownProfessional}.` : 'Extrae el nombre del profesional/estilista.'}
    Necesito extraer todos los servicios o productos listados en la boleta.
    Para cada uno:
    - Nombre del servicio o producto
    - Monto total pagado por ese item
    - Cantidad (si aplica, por defecto 1)
    
    También necesito:
    - Nombre del cliente
    - Fecha (si está disponible)
    ${!knownProfessional ? '- Nombre del profesional/estilista' : ''}

    Responde solo en formato JSON.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data.split(',')[1] || base64Data
          }
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          clientName: { type: Type.STRING },
          professionalName: { type: Type.STRING },
          date: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                serviceName: { type: Type.STRING },
                totalAmount: { type: Type.NUMBER },
                quantity: { type: Type.NUMBER }
              },
              required: ["serviceName", "totalAmount"]
            }
          }
        },
        required: ["items"]
      }
    }
  });

  return JSON.parse(response.text);
}
