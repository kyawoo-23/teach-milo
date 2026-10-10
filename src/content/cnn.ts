import "server-only";
import type { Board } from "@/lib/contracts";

export const CNN_CARD = `For a fixed standard convolution layer, weights = kernelHeight × kernelWidth × inputChannels × outputChannels; with bias, parameters = weights + outputChannels. Spatial input dimensions do not affect these parameters. The same learned filter coefficients are reused at every spatial position. For valid stride one, output spatial dimensions are (H-K+1) × (W-K+1). Multiplications = outputHeight × outputWidth × weights. Fixed 3×3, 3 input channels, 8 filters: 216 weights, 224 parameters. Input32: output30×30×8, 194400 multiplications. Input64: output62×62×8, 830304 multiplications. This claim is for the fixed convolution layer, not an entire network with flatten+dense layers.`;
export const CNN_TRANSFER = {
  question:
    "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.",
  expected:
    "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters for both inputs. The same coefficients are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4. Multiplications increase from 16 × 16 × 200 = 51,200 to 36 × 36 × 200 = 259,200. This result assumes the convolution architecture stays fixed.",
  criteria: [
    "204 parameters in each case, including biases",
    "Explain spatial reuse of the same learned coefficients",
    "Distinguish more spatial computation from more parameters",
  ],
  arithmetic: "cnn" as const,
};
export const CNN_BOARD: Board = {
  kind: "cnn",
  version: 1,
  title: "One filter. Many positions.",
  instruction:
    "Compare the two image sizes. Tell Milo what changes—and what stays the same.",
  assumptions:
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled",
  controls: [],
  metrics: [],
  items: [],
  groups: [],
  code: "",
};
