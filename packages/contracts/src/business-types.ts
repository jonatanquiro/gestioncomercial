export interface BusinessTypeSeed {
  code: string;
  name: string;
  defaultCategories: string[];
  defaultSettings: {
    allowNegativeStock: boolean;
    priceRoundingStep: number;
    saleModes: Array<'unit' | 'weight' | 'length' | 'volume'>;
  };
  recommendedFeatures: string[];
}

const base = { allowNegativeStock: true, priceRoundingStep: 10, saleModes: ['unit'] as Array<'unit' | 'weight' | 'length' | 'volume'> };

/** Rubros iniciales (sección 11 del diseño). */
export const BUSINESS_TYPES: readonly BusinessTypeSeed[] = [
  { code: 'kiosco', name: 'Kiosco', defaultCategories: ['Golosinas', 'Bebidas', 'Cigarrillos', 'Almacén', 'Varios'], defaultSettings: base, recommendedFeatures: ['quick_keys', 'pack_barcodes'] },
  { code: 'almacen', name: 'Almacén o despensa', defaultCategories: ['Almacén', 'Lácteos', 'Fiambrería', 'Bebidas', 'Limpieza', 'Perfumería'], defaultSettings: { ...base, saleModes: ['unit', 'weight'] }, recommendedFeatures: ['weight_sale', 'customer_accounts'] },
  { code: 'minimercado', name: 'Minimercado', defaultCategories: ['Almacén', 'Lácteos', 'Carnes', 'Verdulería', 'Bebidas', 'Limpieza', 'Perfumería'], defaultSettings: { ...base, saleModes: ['unit', 'weight'] }, recommendedFeatures: ['multiple_registers', 'promotions', 'expirations'] },
  { code: 'supermercado', name: 'Supermercado pequeño', defaultCategories: ['Almacén', 'Lácteos', 'Carnes', 'Verdulería', 'Bebidas', 'Limpieza', 'Perfumería', 'Congelados'], defaultSettings: { ...base, saleModes: ['unit', 'weight'] }, recommendedFeatures: ['multiple_registers', 'promotions', 'expirations', 'supplier_price_lists'] },
  { code: 'dietetica', name: 'Dietética', defaultCategories: ['Granos y semillas', 'Frutos secos', 'Harinas', 'Suplementos', 'Sin TACC'], defaultSettings: { ...base, saleModes: ['unit', 'weight'] }, recommendedFeatures: ['weight_sale', 'lots', 'unit_conversions'] },
  { code: 'ferreteria', name: 'Ferretería', defaultCategories: ['Herramientas', 'Electricidad', 'Plomería', 'Bulonería', 'Pinturería'], defaultSettings: { ...base, allowNegativeStock: false, saleModes: ['unit', 'length'] }, recommendedFeatures: ['unit_conversions', 'supplier_price_lists'] },
  { code: 'libreria', name: 'Librería y papelería', defaultCategories: ['Escolar', 'Oficina', 'Libros', 'Regalería'], defaultSettings: base, recommendedFeatures: ['variants', 'kits'] },
  { code: 'ropa', name: 'Tienda de ropa', defaultCategories: ['Remeras', 'Pantalones', 'Abrigos', 'Accesorios'], defaultSettings: { ...base, allowNegativeStock: false }, recommendedFeatures: ['variants'] },
  { code: 'calzado', name: 'Calzado', defaultCategories: ['Zapatillas', 'Zapatos', 'Botas', 'Sandalias'], defaultSettings: { ...base, allowNegativeStock: false }, recommendedFeatures: ['variants'] },
  { code: 'perfumeria', name: 'Perfumería', defaultCategories: ['Fragancias', 'Cosmética', 'Higiene'], defaultSettings: base, recommendedFeatures: ['variants', 'expirations', 'promotions'] },
  { code: 'regaleria', name: 'Regalería', defaultCategories: ['Regalos', 'Decoración', 'Juguetería'], defaultSettings: base, recommendedFeatures: ['kits'] },
  { code: 'hogar', name: 'Artículos para el hogar', defaultCategories: ['Bazar', 'Decoración', 'Textil', 'Electrodomésticos'], defaultSettings: base, recommendedFeatures: ['kits'] },
  { code: 'tecnologia', name: 'Comercio de tecnología', defaultCategories: ['Celulares', 'Accesorios', 'Informática', 'Audio'], defaultSettings: { ...base, allowNegativeStock: false }, recommendedFeatures: ['serial_numbers'] },
  { code: 'otro', name: 'Otro comercio minorista', defaultCategories: [], defaultSettings: base, recommendedFeatures: [] },
];
