// Fake axios: tests set globalThis.__api = async (endpoint, params) => payload, and read globalThis.__apiCalls.
export default {
  create: () => ({
    get: async (endpoint, { params } = {}) => {
      (globalThis.__apiCalls ??= []).push({ endpoint, params });
      return { data: await globalThis.__api(endpoint, params) };
    },
  }),
};
