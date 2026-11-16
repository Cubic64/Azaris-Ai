export type PhoneValidationResult =
  | { valid: true; digits: string; e164: string }
  | { valid: false; error: string };

/**
 * Validates and normalizes an international phone number for WhatsApp (E.164 / wa.me).
 * Strips visual separators (spaces, hyphens, parentheses, dots), rejects letters or
 * leading zeros, and enforces 8-15 digits with country code.
 */
export function validateAndFormatWhatsAppPhone(rawPhone: string): PhoneValidationResult {
  const trimmed = (rawPhone || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number is required (include country code, e.g. +14155550142).' };
  }

  if (/[a-zA-Z]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Phone number cannot contain letters. Use digits and country code (e.g. +14155550142).',
    };
  }

  // Strip common formatting characters: spaces, hyphens, parentheses, dots
  const compact = trimmed.replace(/[\s\-().]/g, '');

  // Disallow unexpected punctuation or misplaced '+' signs
  if (!/^\+?\d+$/.test(compact)) {
    return {
      valid: false,
      error: 'Invalid phone number characters. Only digits and an optional leading "+" are allowed.',
    };
  }

  const digits = compact.startsWith('+') ? compact.slice(1) : compact;

  if (digits.startsWith('0')) {
    return {
      valid: false,
      error: 'Omit leading zeros and include your country code (e.g. +14155550142 or +447700900123).',
    };
  }

  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      error: 'Phone number must be 8 to 15 digits including country code (e.g. +14155550142).',
    };
  }

  return {
    valid: true,
    digits,
    e164: `+${digits}`,
  };
}

export type WaLinkResult =
  | { valid: true; url: string; digits: string; e164: string }
  | { valid: false; error: string };

/**
 * Validates the phone number before constructing a pre-filled https://wa.me/ URI.
 */
export function buildWhatsAppMeUrl(rawPhone: string, message = ''): WaLinkResult {
  const checked = validateAndFormatWhatsAppPhone(rawPhone);
  if (!checked.valid) {
    return checked;
  }

  const base = `https://wa.me/${checked.digits}`;
  const url = message.trim() ? `${base}?text=${encodeURIComponent(message.trim())}` : base;

  return {
    valid: true,
    url,
    digits: checked.digits,
    e164: checked.e164,
  };
}
