import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

// The documented .env lives at the workspace root. Keep a server-local fallback
// for deployments that place configuration beside the server package.
dotenv.config({ path: resolve(sourceDirectory, '../../.env') });
dotenv.config({ path: resolve(sourceDirectory, '../.env') });

const production = process.env.NODE_ENV === 'production';
const configuredOrigin = String(process.env.CLIENT_ORIGIN || '').trim();
const fallbackOrigin = production ? '' : 'http://localhost:5173';
const configuredDeliveryUrl = String(process.env.PASSWORD_RESET_DELIVERY_URL || '').trim();
const configuredDeliveryToken = String(process.env.PASSWORD_RESET_DELIVERY_TOKEN || '').trim();
const configuredDeliveryProvider = String(process.env.PASSWORD_RESET_DELIVERY_PROVIDER || '').trim().toLowerCase();
const configuredResendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const configuredPasswordResetFromEmail = String(process.env.PASSWORD_RESET_FROM_EMAIL || '').trim();

export function parseClientOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function parseTrustProxy(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map(entry => entry.trim()).filter(Boolean);
}

function parseDeliveryUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function validFromEmail(value) {
  if (!value || value.length > 320 || /[\r\n]/.test(value)) return false;
  const address = value.match(/<([^<>]+)>$/)?.[1] || value;
  return /^\S+@\S+\.\S+$/.test(address);
}

export const isProduction = production;
export const clientOrigin = parseClientOrigin(configuredOrigin || fallbackOrigin);
export const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
export const passwordResetDeliveryProvider = configuredDeliveryProvider || (configuredDeliveryUrl || configuredDeliveryToken ? 'webhook' : 'resend');
export const passwordResetFromEmail = configuredPasswordResetFromEmail;
const originConfigurationError = configuredOrigin && !clientOrigin
  ? 'CLIENT_ORIGIN must be an absolute HTTP(S) origin without credentials, query parameters, or fragments.'
  : production && (!clientOrigin || !clientOrigin.startsWith('https:'))
    ? 'CLIENT_ORIGIN must be an HTTPS origin in production.'
    : '';
const deliveryUrl = parseDeliveryUrl(configuredDeliveryUrl);
const webhookConfigurationError = passwordResetDeliveryProvider === 'webhook' && configuredDeliveryUrl && !deliveryUrl
  ? 'PASSWORD_RESET_DELIVERY_URL must be an HTTP(S) URL without credentials.'
  : passwordResetDeliveryProvider === 'webhook' && production && (!deliveryUrl || deliveryUrl.protocol !== 'https:' || !configuredDeliveryToken)
    ? 'Password reset webhook delivery must use an HTTPS URL and bearer token in production.'
    : '';
const resendConfigurationError = passwordResetDeliveryProvider === 'resend' && configuredResendApiKey && /\s/.test(configuredResendApiKey)
  ? 'RESEND_API_KEY must not contain whitespace.'
  : passwordResetDeliveryProvider === 'resend' && configuredPasswordResetFromEmail && !validFromEmail(configuredPasswordResetFromEmail)
    ? 'PASSWORD_RESET_FROM_EMAIL must be an email address or a Name <email> sender.'
    : passwordResetDeliveryProvider === 'resend' && production && (!configuredResendApiKey || !validFromEmail(configuredPasswordResetFromEmail))
      ? 'Resend password reset delivery requires an API key and verified sender email in production.'
      : '';
const providerConfigurationError = configuredDeliveryProvider && !['resend', 'webhook'].includes(configuredDeliveryProvider)
  ? 'PASSWORD_RESET_DELIVERY_PROVIDER must be resend or webhook.'
  : '';
export const configurationError = originConfigurationError || providerConfigurationError || webhookConfigurationError || resendConfigurationError;
