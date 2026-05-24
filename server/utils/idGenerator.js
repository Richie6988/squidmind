/**
 * Unique ID Generator for SquidMind
 * Format: {type}_{timestamp}_{random4}
 */

function generateUniqueId(type) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `${type}_${timestamp}_${random}`;
}

module.exports = { generateUniqueId };
