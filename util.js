function mod(value, modulus) {
  return (value % modulus + modulus) % modulus;
}

function deadzone(value, radius) {
  if (value < 0) {
    return -deadzone(-value, radius);
  } else if (value < radius) {
    return 0;
  } else {
    return value - radius;
  }
}

function signum(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}