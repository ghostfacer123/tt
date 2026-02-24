import * as ImageManipulator from 'expo-image-manipulator';

const OCR_SPACE_API_KEY = 'K87153949488957';
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

const compressImage = async (uri: string): Promise<string> => {
  try {
    const manipResult = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipResult.uri;
  } catch (error) {
    console.error('Image compression failed:', error);
    return uri;
  }
};

export interface ReceiptItem {
  quantity: number;
  name: string;
  description?: string;
  price: number;
}

export interface ReceiptData {
  merchantName: string;
  total: number;
  taxAmount: number;
  serviceCharge: number;
  date: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  serviceFee: number;
  items: ReceiptItem[];
}

/**
 * Parse Talabat/delivery-style receipts where items and prices are on separate lines.
 * Talabat OCR outputs a two-column layout: all item/label names first, then all prices
 * at the bottom. E.g.:
 *   1 x Rib Eye Steak Platter
 *   1 x Molten Cake
 *   Subtotal
 *   Delivery fee
 *   Total
 *   EGP 450.00
 *   EGP 100.00
 *   EGP 750.00
 *   EGP 31.99
 *   EGP 794.98
 */
const parseSplitColumnReceipt = (
  lines: string[]
): Pick<ReceiptData, 'items' | 'subtotal' | 'discount' | 'deliveryFee' | 'serviceFee' | 'total'> | null => {
  const itemRe = /^(\d+)\s*[xX×]\s+(.+)$/i;
  const egpLineRe = /^EGP\s+([\d,.]+)$/i;

  // Find the subtotal line to split items from totals
  const subtotalIdx = lines.findIndex((l) => /^subtotal$/i.test(l.trim()));
  if (subtotalIdx < 0) return null;

  const itemSection = lines.slice(0, subtotalIdx);

  // Extract items with descriptions from item section
  const rawItems: Array<{ quantity: number; name: string; description: string }> = [];
  for (let i = 0; i < itemSection.length; i++) {
    const line = itemSection[i].trim();
    const m = line.match(itemRe);
    if (!m) continue;

    const quantity = parseInt(m[1], 10);
    const name = m[2].trim();

    // Collect description lines until next item line or end of section
    let description = '';
    let j = i + 1;
    while (j < itemSection.length) {
      const next = itemSection[j].trim();
      if (!next || itemRe.test(next)) break;
      description += (description ? ' ' : '') + next;
      j++;
    }

    rawItems.push({ quantity, name, description: description.trim() });
  }

  if (rawItems.length === 0) return null;

  // Extract all standalone EGP price lines from the entire text
  const allPrices: number[] = [];
  for (const line of lines) {
    const m = line.trim().match(egpLineRe);
    if (m) {
      allPrices.push(parseFloat(m[1].replace(',', '')));
    }
  }

  // The first rawItems.length prices are item prices; the rest are totals values
  const itemPrices = allPrices.slice(0, rawItems.length);
  const totalsPrices = allPrices.slice(rawItems.length);

  // Map totals prices to their labels (in order they appear after subtotalIdx)
  const totalsLabelLines = lines.slice(subtotalIdx).filter((l) =>
    /^(subtotal|discount|delivery|service|total)/i.test(l.trim())
  );

  let subtotal = 0;
  let discount = 0;
  let deliveryFee = 0;
  let serviceFee = 0;
  let total = 0;
  let foundSubtotalLabel = false;

  totalsLabelLines.forEach((label, i) => {
    if (i >= totalsPrices.length) return;
    const l = label.trim().toLowerCase();
    if (/subtotal/.test(l)) { subtotal = totalsPrices[i]; foundSubtotalLabel = true; }
    else if (/discount/.test(l)) discount = totalsPrices[i];
    else if (/delivery/.test(l)) deliveryFee = totalsPrices[i];
    else if (/service/.test(l)) serviceFee = totalsPrices[i];
    else if (/^total/.test(l)) total = totalsPrices[i];
  });

  const items: ReceiptItem[] = rawItems.map((item, i) => ({
    quantity: item.quantity,
    name: item.name,
    description: item.description || undefined,
    price: itemPrices[i] || 0,
  }));

  if (!foundSubtotalLabel && items.length > 0) {
    subtotal = items.reduce((s, item) => s + item.price * item.quantity, 0);
  }
  if (total === 0) {
    total = subtotal - discount + deliveryFee + serviceFee;
  }

  return { items, subtotal, discount, deliveryFee, serviceFee, total };
};

/**
 * Parse Talabat/delivery-style receipts that have itemized lists.
 * Pattern: "[qty] x [item name]  [currency] [price]"
 */
const parseDeliveryReceipt = (
  lines: string[]
): Pick<ReceiptData, 'items' | 'subtotal' | 'discount' | 'deliveryFee' | 'serviceFee' | 'total'> | null => {
  // Look for lines matching: number x item   CURRENCY price
  const itemRe = /^(\d+)\s*[xX×]\s+(.+?)\s+(?:EGP|SAR|AED|USD|EUR|\$|€)\s*([\d,]+\.?\d*)\s*$/i;
  const amountRe = /(?:EGP|SAR|AED|USD|EUR|\$|€)\s*([\d,]+\.?\d*)/i;

  const items: ReceiptItem[] = [];
  let subtotal = 0;
  let discount = 0;
  let deliveryFee = 0;
  let serviceFee = 0;
  let total = 0;
  let hasItems = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    const itemMatch = line.match(itemRe);
    if (itemMatch) {
      hasItems = true;
      const qty = parseInt(itemMatch[1], 10);
      const name = itemMatch[2].trim();
      const price = parseFloat(itemMatch[3].replace(',', ''));

      // Look ahead for a description line (non-price, non-item line immediately after)
      let description = '';
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) { j++; continue; }
        if (
          itemRe.test(nextLine) ||
          /\b(subtotal|total|discount|delivery|service)\b/i.test(nextLine) ||
          amountRe.test(nextLine)
        ) break;
        description = nextLine;
        j++;
        break;
      }
      if (description) i = j - 1;

      items.push({ quantity: qty, name, description: description || undefined, price });

      i++;
      continue;
    }

    // Check for subtotal/discount/delivery/service/total lines
    const lower = line.toLowerCase();
    const amountMatch = line.match(amountRe);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[1].replace(',', ''));
      if (/\bsubtotal\b/i.test(lower)) {
        subtotal = amount;
      } else if (/\bdiscount\b/i.test(lower)) {
        discount = amount;
      } else if (/delivery\s*fee/i.test(lower)) {
        deliveryFee = amount;
      } else if (/service\s*fee/i.test(lower)) {
        serviceFee = amount;
      } else if (/\btotal\b/i.test(lower) && !/subtotal/i.test(lower)) {
        total = amount;
      }
    }

    i++;
  }

  if (!hasItems) return null;

  // Calculate subtotal from items if not found
  if (subtotal === 0 && items.length > 0) {
    subtotal = items.reduce((s, item) => s + item.price, 0);
  }

  // Calculate total if not found
  if (total === 0) {
    total = subtotal - discount + deliveryFee + serviceFee;
  }

  return { items, subtotal, discount, deliveryFee, serviceFee, total };
};

const extractReceiptDataFromText = (text: string): ReceiptData => {
  console.log('📝 Full OCR text:', text);

  const lines = text.split('\n').filter((line) => line.trim());

  // Try split-column Talabat-style parsing first (items and prices on separate lines),
  // then fall back to same-line parsing.
  const deliveryResult = parseSplitColumnReceipt(lines) ?? parseDeliveryReceipt(lines);

  // Patterns
  const priceRe = /(?:^|[\s:x×*])\$?\s*(\d{1,6}(?:[,.]\d{1,3})*(?:\.\d{1,2})?)\s*(?:EGP|LE|L\.E\.|SAR|AED|USD|EUR|جنيه|ج\.م|﷼)?(?:\s|$)/i;
  const totalRe = /\b(?:total|grand\s*total|المجموع|اجمالي|إجمالي|مجموع)\b/i;
  const taxRe = /\b(?:tax|vat|ضريبة|ضرائب|قيمة\s*مضافة)\b/i;
  const serviceRe = /\b(?:service|tip|gratuity|خدمة)\b/i;
  const dateRe = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/;
  const skipRe = /\b(?:subtotal|receipt|invoice|order|cashier|server|table|date|time|phone|address|thank|welcome|كاشير|فاتورة|طلب)\b/i;

  // Merchant name - first non-trivial, non-price line
  let merchantName = 'Unknown Merchant';
  for (const line of lines.slice(0, 5)) {
    if (line.length > 2 && !/^\d+$/.test(line) && !dateRe.test(line) && !priceRe.test(line)) {
      merchantName = line.trim();
      break;
    }
  }

  const dateMatch = text.match(dateRe);
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

  const taxMatch = text.match(/tax[:\s]*\$?\s*(\d+[,.]?\d*\.?\d{2})/i);
  const taxAmount = taxMatch ? parseFloat(taxMatch[1].replace(',', '')) : 0;

  const serviceMatch = text.match(/(?:service|tip|gratuity)[:\s]*\$?\s*(\d+[,.]?\d*\.?\d{2})/i);
  const serviceCharge = serviceMatch ? parseFloat(serviceMatch[1].replace(',', '')) : 0;

  // If delivery-style parsing succeeded, use that data
  if (deliveryResult) {
    return {
      merchantName,
      total: deliveryResult.total,
      taxAmount,
      serviceCharge: deliveryResult.serviceFee || serviceCharge,
      date,
      subtotal: deliveryResult.subtotal,
      discount: deliveryResult.discount,
      deliveryFee: deliveryResult.deliveryFee,
      serviceFee: deliveryResult.serviceFee,
      items: deliveryResult.items,
    };
  }

  // Fallback: standard receipt parsing
  let total = 0;
  let fallbackSubtotal = 0;
  let fallbackDiscount = 0;
  let fallbackDeliveryFee = 0;
  let fallbackServiceFee = 0;
  const items: ReceiptItem[] = [];

  const deliveryRe = /\b(?:delivery|delivery\s*fee|delivery\s*charge|توصيل)\b/i;
  const discountRe = /\b(?:discount|خصم|تخفيض)\b/i;
  const subtotalRe = /\b(?:subtotal|sub\s*total|المجموع\s*الفرعي)\b/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (totalRe.test(trimmed) && !subtotalRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m) total = parseFloat(m[1].replace(',', ''));
      continue;
    }

    if (subtotalRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m) fallbackSubtotal = parseFloat(m[1].replace(',', ''));
      continue;
    }

    if (discountRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m) fallbackDiscount = parseFloat(m[1].replace(',', ''));
      continue;
    }

    if (deliveryRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m) fallbackDeliveryFee = parseFloat(m[1].replace(',', ''));
      continue;
    }

    if (taxRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m && taxAmount === 0) {
        // already captured in taxAmount above; skip as item
      }
      continue;
    }

    if (serviceRe.test(trimmed)) {
      const m = trimmed.match(priceRe);
      if (m) fallbackServiceFee = parseFloat(m[1].replace(',', ''));
      continue;
    }

    if (skipRe.test(trimmed)) continue;

    const m = trimmed.match(priceRe);
    if (m) {
      const amount = parseFloat(m[1].replace(',', ''));
      const description = trimmed
        .replace(m[0], '')
        .replace(/\$|EGP|LE|L\.E\.|SAR|AED|USD|EUR|جنيه|ج\.م|﷼/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (description && amount > 0 && amount < 100_000) {
        items.push({ quantity: 1, name: description, price: amount });
      }
    }
  }

  const effectiveServiceFee = fallbackServiceFee || serviceCharge;
  const effectiveSubtotal = fallbackSubtotal || (items.length > 0 ? items.reduce((s, i) => s + i.price, 0) : 0);

  // Fallback: if no explicit total, calculate from components
  if (total === 0 && items.length > 0) {
    total = effectiveSubtotal + fallbackDeliveryFee + effectiveServiceFee - fallbackDiscount;
  }

  // Final fallback: largest amount in text
  if (total === 0) {
    const amounts: number[] = [];
    const allMatches = text.matchAll(/\$?\s*(\d+[,.]?\d*\.?\d{2})/g);
    for (const match of allMatches) {
      const num = parseFloat(match[1].replace(',', ''));
      if (!isNaN(num) && num > 0) amounts.push(num);
    }
    if (amounts.length > 0) total = Math.max(...amounts);
  }

  return {
    merchantName,
    total,
    taxAmount,
    serviceCharge: effectiveServiceFee,
    date,
    subtotal: effectiveSubtotal || total,
    discount: fallbackDiscount,
    deliveryFee: fallbackDeliveryFee,
    serviceFee: effectiveServiceFee,
    items,
  };
};

export const analyzeReceiptWithOCRSpace = async (imageUri: string): Promise<ReceiptData> => {
  try {
    console.log('📸 Image URI:', imageUri);

    const compressedUri = await compressImage(imageUri);
    console.log('🖼️ Using compressed URI:', compressedUri);

    console.log('🔑 Using OCR.space API Key:', OCR_SPACE_API_KEY);

    const formData = new FormData();
    formData.append('file', {
      uri: compressedUri,
      type: 'image/jpeg',
      name: 'receipt.jpg',
    } as any);
    formData.append('apikey', OCR_SPACE_API_KEY);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2'); // Engine 2 is more accurate

    console.log('🚀 Sending request to OCR.space...');

    const response = await fetch(OCR_SPACE_URL, {
      method: 'POST',
      body: formData,
    });

    console.log('📡 Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ Error response:', errorText);
      throw new Error(`OCR.space API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ OCR.space response:', JSON.stringify(result, null, 2));

    if (result.IsErroredOnProcessing) {
      throw new Error(result.ErrorMessage?.[0] || 'OCR processing failed');
    }

    const parsedText = result.ParsedResults?.[0]?.ParsedText || '';
    
    if (!parsedText) {
      throw new Error('No text extracted from receipt');
    }

    console.log('📄 Extracted text:', parsedText);

    return extractReceiptDataFromText(parsedText);
  } catch (error) {
    console.error('❌ OCR.space Error:', error);
    throw new Error('Failed to analyze receipt. Please try again.');
  }
};
