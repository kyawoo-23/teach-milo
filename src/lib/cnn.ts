export function convolution(
  size: number,
  kernel = 3,
  inputChannels = 3,
  outputChannels = 8,
) {
  const outputSize = size - kernel + 1;
  if (
    ![size, kernel, inputChannels, outputChannels].every(
      (x) => Number.isSafeInteger(x) && x > 0,
    ) ||
    outputSize < 1
  )
    throw new Error("Invalid convolution dimensions");
  const weights = kernel * kernel * inputChannels * outputChannels;
  return {
    outputSize,
    weights,
    parameters: weights + outputChannels,
    multiplications: outputSize * outputSize * weights,
  };
}
