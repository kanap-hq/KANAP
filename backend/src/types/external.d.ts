declare module 'csv-parse/sync' {
  import { ParserOptions } from 'csv-parse';
  export function parse<T = any>(input: string | Buffer, options?: ParserOptions): T[];
}

// `cors` ships without types and @types/cors is not a dependency. Declared here, alongside
// the other untyped modules, rather than adding a package: strict mode's noImplicitAny was
// the only thing that objected to it.
declare module 'cors';
