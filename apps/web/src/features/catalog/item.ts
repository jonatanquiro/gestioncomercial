import type { ItemDto, ProductDto, ProductVariantDto } from '@gc/contracts';

/** Una variante de un producto con la forma de ItemDto, la que usan la venta y las etiquetas. */
export function itemOf(p: ProductDto, v: ProductVariantDto = p.variants[0]!): ItemDto {
  return {
    productId: p.id, variantId: v.id, name: p.name, variantLabel: v.label, kind: p.kind, saleMode: p.saleMode, trackStock: p.trackStock,
    minStock: p.minStock, sku: v.sku, price: v.price, cashPrice: v.cashPrice, cost: v.cost, barcodes: v.barcodes, stock: v.stock, status: p.status,
  };
}
