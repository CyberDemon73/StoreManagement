'use client';
/**
 * Cart state for the POS. A reducer persisted to localStorage (`avenue.cart`) so a refresh
 * mid-sale keeps the lines. The server recomputes every total; `api.sales.preview` mirrors
 * its rules for display.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Cart, CartLine, PaymentMethod, Variant } from '@/types';

export const CART_KEY = 'avenue.cart';

export const EMPTY_CART: Cart = { lines: [], discount: { type: 'PCT', value: 0 }, paymentMethod: 'CASH' };

/** Minimal product info a line needs beside the variant. */
export interface CartProductRef { id: string; name: string; tint: string }

type Action =
  | { type: 'add'; variant: Variant; product: CartProductRef; qty?: number }
  | { type: 'setQty'; variantId: string; qty: number }
  | { type: 'remove'; variantId: string }
  | { type: 'clear' }
  | { type: 'load'; cart: Cart }
  | { type: 'discount'; discount: Cart['discount'] }
  | { type: 'payment'; method: PaymentMethod }
  | { type: 'customer'; name?: string; phone?: string }
  | { type: 'note'; note: string };

function reduce(cart: Cart, a: Action): Cart {
  switch (a.type) {
    case 'add': {
      const qty = a.qty ?? 1;
      const i = cart.lines.findIndex((l) => l.variantId === a.variant.id);
      const existing = cart.lines[i];
      if (existing) {
        const lines = cart.lines.slice();
        lines[i] = { ...existing, qty: Math.min(existing.qty + qty, Math.max(1, existing.available)), available: a.variant.quantity, unitPrice: a.variant.sellPrice };
        return { ...cart, lines };
      }
      const line: CartLine = {
        variantId: a.variant.id, productId: a.product.id, productName: a.product.name, size: a.variant.size, color: a.variant.color,
        sku: a.variant.sku, tint: a.product.tint, unitPrice: a.variant.sellPrice, qty: Math.min(qty, Math.max(1, a.variant.quantity)), available: a.variant.quantity,
      };
      return { ...cart, lines: [line, ...cart.lines] };
    }
    case 'setQty': {
      if (a.qty <= 0) return { ...cart, lines: cart.lines.filter((l) => l.variantId !== a.variantId) };
      return { ...cart, lines: cart.lines.map((l) => (l.variantId === a.variantId ? { ...l, qty: Math.min(a.qty, Math.max(1, l.available)) } : l)) };
    }
    case 'remove':
      return { ...cart, lines: cart.lines.filter((l) => l.variantId !== a.variantId) };
    case 'clear':
      return EMPTY_CART;
    case 'load':
      return { ...EMPTY_CART, ...a.cart, lines: a.cart.lines ?? [] };
    case 'discount':
      return { ...cart, discount: { type: a.discount.type, value: Math.max(0, a.discount.value) } };
    case 'payment':
      return { ...cart, paymentMethod: a.method };
    case 'customer':
      return { ...cart, customerName: a.name ?? cart.customerName, customerPhone: a.phone ?? cart.customerPhone };
    case 'note':
      return { ...cart, note: a.note };
  }
}

function read(): Cart | null {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cart>;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return { ...EMPTY_CART, ...parsed, lines: parsed.lines };
  } catch {
    return null;
  }
}

export interface CartActions {
  add: (variant: Variant, product: CartProductRef, qty?: number) => void;
  setQty: (variantId: string, qty: number) => void;
  inc: (variantId: string) => void;
  dec: (variantId: string) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  load: (cart: Cart) => void;
  setDiscount: (discount: Cart['discount']) => void;
  setPayment: (method: PaymentMethod) => void;
  setCustomer: (patch: { name?: string; phone?: string }) => void;
  setNote: (note: string) => void;
}

export function useCart(): { cart: Cart; actions: CartActions; hydrated: boolean; count: number } {
  const [cart, dispatch] = useReducer(reduce, EMPTY_CART);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = read();
    if (saved && saved.lines.length) dispatch({ type: 'load', cart: saved });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode */ }
  }, [cart, hydrated]);

  const cartRef = useRef(cart);
  cartRef.current = cart;

  const actions = useMemo<CartActions>(() => ({
    add: (variant, product, qty) => dispatch({ type: 'add', variant, product, qty }),
    setQty: (variantId, qty) => dispatch({ type: 'setQty', variantId, qty }),
    inc: (variantId) => { const l = cartRef.current.lines.find((x) => x.variantId === variantId); if (l) dispatch({ type: 'setQty', variantId, qty: l.qty + 1 }); },
    dec: (variantId) => { const l = cartRef.current.lines.find((x) => x.variantId === variantId); if (l) dispatch({ type: 'setQty', variantId, qty: l.qty - 1 }); },
    remove: (variantId) => dispatch({ type: 'remove', variantId }),
    clear: () => dispatch({ type: 'clear' }),
    load: (c) => dispatch({ type: 'load', cart: c }),
    setDiscount: (discount) => dispatch({ type: 'discount', discount }),
    setPayment: (method) => dispatch({ type: 'payment', method }),
    setCustomer: (p) => dispatch({ type: 'customer', ...p }),
    setNote: (note) => dispatch({ type: 'note', note }),
  }), []);

  const count = cart.lines.reduce((a, l) => a + l.qty, 0);
  return { cart, actions, hydrated, count };
}
