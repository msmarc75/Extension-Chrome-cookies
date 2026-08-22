/*
 * Stripe, kept to the two things it is actually needed for.
 *
 * The Chrome Web Store stopped taking payments in 2021, so a paid extension
 * needs a payment processor and a licence server; that is the whole reason this
 * file exists. What it does is create a Checkout session and read a webhook.
 *
 * The official library is used rather than two hand-written HTTP calls, for one
 * reason that is not convenience: **webhook signature verification**. Getting it
 * wrong means anyone who learns the endpoint can mint themselves a licence, and
 * the failure is silent — a hand-rolled verifier that forgets the timestamp
 * tolerance, or compares with `===`, passes every test you would think to write.
 * The library also generates valid signatures for tests, which is how this
 * project's webhook path is exercised without a Stripe account.
 */

import Stripe from 'stripe';

export class BillingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
  }
}

/** Prices are configured, never hard-coded: they change without a release. */
export const priceFor = (plan) =>
  ({
    pro: process.env.STRIPE_PRICE_PRO ?? null,
    agency: process.env.STRIPE_PRICE_AGENCY ?? null,
  })[plan] ?? null;

/**
 * @param {object} [options]
 * @param {string} [options.secretKey] defaults to STRIPE_SECRET_KEY
 * @param {string} [options.webhookSecret] defaults to STRIPE_WEBHOOK_SECRET
 */
export function createBilling({
  secretKey = process.env.STRIPE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
} = {}) {
  if (!secretKey) {
    throw new BillingError('NO_STRIPE_KEY', 'STRIPE_SECRET_KEY is not set');
  }
  const stripe = new Stripe(secretKey);

  return {
    /** Exposed so a test can sign a payload the way Stripe signs one. */
    stripe,

    /**
     * Start a purchase. Returns the URL the extension opens in a tab.
     *
     * The plan travels in the session's metadata rather than being inferred
     * from the price at webhook time: prices get archived and replaced, and a
     * webhook arriving after that must still know what was bought.
     */
    async createCheckout({ plan, email = null, successUrl, cancelUrl }) {
      const price = priceFor(plan);
      if (!price) throw new BillingError('UNKNOWN_PLAN', `No price configured for plan "${plan}"`);

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(email ? { customer_email: email } : {}),
        metadata: { plan },
        subscription_data: { metadata: { plan } },
      });

      return { id: session.id, url: session.url };
    },

    /**
     * Verify and parse a webhook.
     *
     * The raw body is required — parsing it first and re-serialising changes a
     * byte somewhere and the signature stops matching, which is the classic way
     * this integration is broken.
     */
    constructEvent(rawBody, signature) {
      if (!webhookSecret) {
        throw new BillingError('NO_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET is not set');
      }
      try {
        return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (cause) {
        throw new BillingError('BAD_SIGNATURE', `Webhook signature rejected: ${cause.message}`);
      }
    },
  };
}

/**
 * What a webhook event means for a licence.
 *
 * Split out from the transport so the decision — issue, revoke, ignore — is a
 * pure function over an event, and can be tested against the payloads Stripe
 * documents without a network or a key.
 *
 * @param {object} event a Stripe event
 * @returns {{action: 'issue'|'revoke'|'ignore', plan?: string, email?: string|null, sessionId?: string, customerId?: string|null, subscriptionId?: string|null, subscriptionId?: string, reason?: string}}
 */
export function decideFromEvent(event) {
  const object = event?.data?.object ?? {};

  switch (event?.type) {
    case 'checkout.session.completed':
      /* An unpaid session is a session that was opened, not a purchase. */
      if (object.payment_status && object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required') {
        return { action: 'ignore', reason: `payment_status ${object.payment_status}` };
      }
      return {
        action: 'issue',
        plan: object.metadata?.plan ?? 'pro',
        email: object.customer_details?.email ?? object.customer_email ?? null,
        sessionId: object.id,
        customerId: typeof object.customer === 'string' ? object.customer : (object.customer?.id ?? null),
        subscriptionId:
          typeof object.subscription === 'string' ? object.subscription : (object.subscription?.id ?? null),
      };

    case 'customer.subscription.deleted':
      return { action: 'revoke', subscriptionId: object.id, reason: 'cancelled' };

    case 'charge.refunded':
      return { action: 'revoke', customerId: object.customer ?? null, reason: 'refunded' };

    /*
     * Everything else is acknowledged and ignored on purpose. Stripe retries an
     * endpoint that answers with an error, so a service that failed on an event
     * type it does not handle would be retried until Stripe gave up and
     * disabled the endpoint — taking the events that matter with it.
     */
    default:
      return { action: 'ignore', reason: `unhandled event ${event?.type}` };
  }
}
