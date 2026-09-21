import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

// Local npm commands use .env.local; production start commands and explicitly
// production-configured processes use .env. Load only the selected file so a
// missing local value can never silently fall back to production configuration.
const productionEnvironment = process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';
export const environmentFileName = productionEnvironment ? '.env' : '.env.local';
dotenv.config({ path: resolve(sourceDirectory, '../../', environmentFileName) });
dotenv.config({ path: resolve(sourceDirectory, '../', environmentFileName) });

const production = productionEnvironment;
const configuredOrigin = String(process.env.CLIENT_ORIGIN || '').trim();
const fallbackOrigin = production ? '' : 'http://localhost:5173';
const configuredDeliveryUrl = String(process.env.PASSWORD_RESET_DELIVERY_URL || '').trim();
const configuredDeliveryToken = String(process.env.PASSWORD_RESET_DELIVERY_TOKEN || '').trim();
const configuredDeliveryProvider = String(process.env.PASSWORD_RESET_DELIVERY_PROVIDER || '').trim().toLowerCase();
const configuredResendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const configuredPasswordResetFromEmail = String(process.env.PASSWORD_RESET_FROM_EMAIL || '').trim();
const configuredReportTimeZone = String(process.env.REPORT_TIME_ZONE || '').trim() || 'America/Los_Angeles';

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

function validTimeZone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; }
  catch { return false; }
}

export const isProduction = production;
export const clientOrigin = parseClientOrigin(configuredOrigin || fallbackOrigin);
export const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
export const passwordResetDeliveryProvider = configuredDeliveryProvider || (configuredDeliveryUrl || configuredDeliveryToken ? 'webhook' : 'resend');
export const passwordResetFromEmail = configuredPasswordResetFromEmail;
export const reportTimeZone = configuredReportTimeZone;
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
const reportTimeZoneConfigurationError = !validTimeZone(configuredReportTimeZone)
  ? 'REPORT_TIME_ZONE must be a valid IANA timezone.'
  : '';
export const passwordResetConfigurationError = process.env.NODE_ENV === 'test'
  ? ''
  : passwordResetDeliveryProvider === 'resend' && (!configuredResendApiKey || !validFromEmail(configuredPasswordResetFromEmail))
    ? 'Resend password reset delivery requires an API key and verified sender email.'
    : passwordResetDeliveryProvider === 'webhook' && !deliveryUrl
      ? 'Password reset webhook delivery requires a valid URL.'
      : providerConfigurationError || webhookConfigurationError || resendConfigurationError;
export const configurationError = originConfigurationError || providerConfigurationError || webhookConfigurationError || resendConfigurationError || reportTimeZoneConfigurationError || passwordResetConfigurationError;
