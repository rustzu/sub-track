/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./worker.js'],
  theme: {
    extend: {},
  },
  plugins: [require('@tailwindcss/forms')],
};
