export const teachingPhrases = {
  vi: {
    "Hi!": "Chào bạn!",
    "Can you say a bit more about that?": "Bạn nói thêm một chút được không?",
    "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?":
      "Lời giải thích của bạn giúp mình nối các ý chính lại. Bạn muốn tự thử một ví dụ mới, hay tiếp tục dạy mình?",
    "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.":
      "Bạn chọn một ví dụ nhỏ, dẫn mình xem chuyện gì xảy ra, và giải thích vì sao mỗi bước nối tiếp được không? Bắt đầu từ phần bạn chắc nhất.",
    "Make it concrete": "Làm cho khái niệm cụ thể",
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.":
      "Dạy Milo bằng một ví dụ đã giải, một phép so sánh, hoặc một trình diễn từng bước.",
    "Add an example and explain why it fits the concept.":
      "Thêm một ví dụ và giải thích vì sao nó phù hợp với khái niệm.",
    Concept: "Khái niệm",
    Example: "Ví dụ",
    "Why it fits": "Vì sao phù hợp",
    "Input image size": "Kích thước ảnh đầu vào",
    Sequence: "Thứ tự bước",
    "Selected item": "Mục đã chọn",
    "One filter. Many positions.": "Một bộ lọc. Nhiều vị trí.",
    "Compare the two image sizes. Tell Milo what changes—and what stays the same.":
      "So sánh hai kích thước ảnh. Nói với Milo điều gì thay đổi và điều gì giữ nguyên.",
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled":
      "Tích chập hợp lệ · stride 1 · kernel 3×3 · 3 kênh đầu vào · 8 bộ lọc · có bias",
    "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.":
      "Một phép tích chập hợp lệ, stride 1, có kernel 5×5, 2 kênh đầu vào và 4 bộ lọc đầu ra, kèm bias. So sánh đầu vào 20×20×2 và 40×40×2. Mỗi trường hợp có bao nhiêu tham số đã học, và điều gì thay đổi khi ảnh lớn hơn? Giải thích vì sao.",
    "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters for both inputs. The same coefficients are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4. Multiplications increase from 16 × 16 × 200 = 51,200 to 36 × 36 × 200 = 259,200. This result assumes the convolution architecture stays fixed.":
      "5 × 5 × 2 × 4 = 200 trọng số, cộng 4 bias = 204 tham số cho cả hai đầu vào. Cùng các hệ số được dùng lại ở nhiều vị trí không gian hơn. Kích thước đầu ra là 16 × 16 × 4 và 36 × 36 × 4. Số phép nhân tăng từ 16 × 16 × 200 = 51.200 lên 36 × 36 × 200 = 259.200. Kết quả này giả định kiến trúc tích chập không đổi.",
    "204 parameters in each case, including biases":
      "204 tham số trong mỗi trường hợp, gồm cả bias",
    "Explain spatial reuse of the same learned coefficients":
      "Giải thích việc dùng lại cùng các hệ số đã học trên không gian",
    "Distinguish more spatial computation from more parameters":
      "Phân biệt nhiều phép tính không gian hơn với nhiều tham số hơn",
  },
  id: {
    "Hi!": "Halo!",
    "Can you say a bit more about that?": "Bisa jelaskan sedikit lebih lanjut?",
    "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?":
      "Penjelasanmu membantu saya menghubungkan gagasan utama. Mau mencoba contoh baru sendiri, atau terus mengajari saya?",
    "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.":
      "Bisa pilih satu contoh kecil, tunjukkan apa yang terjadi, dan jelaskan mengapa setiap langkah menyusul? Mulai dari bagian yang paling kamu yakini.",
    "Make it concrete": "Buat konsepnya konkret",
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.":
      "Ajari Milo dengan contoh yang sudah dikerjakan, analogi, atau demonstrasi langkah demi langkah.",
    "Add an example and explain why it fits the concept.":
      "Tambahkan contoh dan jelaskan mengapa contoh itu sesuai dengan konsepnya.",
    Concept: "Konsep",
    Example: "Contoh",
    "Why it fits": "Mengapa sesuai",
    "Input image size": "Ukuran gambar masukan",
    Sequence: "Urutan langkah",
    "Selected item": "Item yang dipilih",
    "One filter. Many positions.": "Satu filter. Banyak posisi.",
    "Compare the two image sizes. Tell Milo what changes—and what stays the same.":
      "Bandingkan dua ukuran gambar. Beri tahu Milo apa yang berubah dan apa yang tetap sama.",
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled":
      "Konvolusi valid · stride 1 · kernel 3×3 · 3 kanal masukan · 8 filter · bias aktif",
    "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.":
      "Konvolusi valid dengan stride 1 memiliki kernel 5×5, 2 kanal masukan, dan 4 filter keluaran, beserta bias. Bandingkan masukan 20×20×2 dan 40×40×2. Berapa parameter yang dipelajari pada masing-masing kasus, dan apa yang berubah saat gambar membesar? Jelaskan mengapa.",
    "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters for both inputs. The same coefficients are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4. Multiplications increase from 16 × 16 × 200 = 51,200 to 36 × 36 × 200 = 259,200. This result assumes the convolution architecture stays fixed.":
      "5 × 5 × 2 × 4 = 200 bobot, ditambah 4 bias = 204 parameter untuk kedua masukan. Koefisien yang sama dipakai ulang di lebih banyak posisi spasial. Bentuk keluaran adalah 16 × 16 × 4 dan 36 × 36 × 4. Perkalian bertambah dari 16 × 16 × 200 = 51.200 menjadi 36 × 36 × 200 = 259.200. Hasil ini mengasumsikan arsitektur konvolusi tetap.",
    "204 parameters in each case, including biases":
      "204 parameter pada setiap kasus, termasuk bias",
    "Explain spatial reuse of the same learned coefficients":
      "Jelaskan pemakaian ulang spasial koefisien yang sama",
    "Distinguish more spatial computation from more parameters":
      "Bedakan komputasi spasial yang lebih banyak dari parameter yang lebih banyak",
  },
  ms: {
    "Hi!": "Hai!",
    "Can you say a bit more about that?": "Boleh terangkan sedikit lagi?",
    "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?":
      "Penerangan anda membantu saya menghubungkan idea utama. Mahu cuba contoh baharu sendiri, atau terus mengajar saya?",
    "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.":
      "Boleh pilih satu contoh kecil, tunjukkan apa yang berlaku, dan terangkan mengapa setiap langkah menyusul? Mulakan dengan bahagian yang paling anda pasti.",
    "Make it concrete": "Jadikan konsep itu konkrit",
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.":
      "Ajar Milo dengan contoh yang sudah dikerjakan, analogi, atau demonstrasi langkah demi langkah.",
    "Add an example and explain why it fits the concept.":
      "Tambah satu contoh dan terangkan mengapa ia sesuai dengan konsep itu.",
    Concept: "Konsep",
    Example: "Contoh",
    "Why it fits": "Mengapa ia sesuai",
    "Input image size": "Saiz imej input",
    Sequence: "Urutan langkah",
    "Selected item": "Item yang dipilih",
    "One filter. Many positions.": "Satu penapis. Banyak kedudukan.",
    "Compare the two image sizes. Tell Milo what changes—and what stays the same.":
      "Bandingkan dua saiz imej. Beritahu Milo apa yang berubah dan apa yang kekal sama.",
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled":
      "Konvolusi sah · stride 1 · kernel 3×3 · 3 saluran input · 8 penapis · bias diaktifkan",
    "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.":
      "Konvolusi sah dengan stride 1 mempunyai kernel 5×5, 2 saluran input, dan 4 penapis output, beserta bias. Bandingkan input 20×20×2 dan 40×40×2. Berapa parameter yang dipelajari dalam setiap kes, dan apa yang berubah apabila imej membesar? Terangkan mengapa.",
    "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters for both inputs. The same coefficients are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4. Multiplications increase from 16 × 16 × 200 = 51,200 to 36 × 36 × 200 = 259,200. This result assumes the convolution architecture stays fixed.":
      "5 × 5 × 2 × 4 = 200 pemberat, campur 4 bias = 204 parameter untuk kedua-dua input. Pekali yang sama digunakan semula di lebih banyak kedudukan ruang. Bentuk output ialah 16 × 16 × 4 dan 36 × 36 × 4. Pendaraban meningkat daripada 16 × 16 × 200 = 51,200 kepada 36 × 36 × 200 = 259,200. Hasil ini mengandaikan seni bina konvolusi kekal.",
    "204 parameters in each case, including biases":
      "204 parameter dalam setiap kes, termasuk bias",
    "Explain spatial reuse of the same learned coefficients":
      "Terangkan penggunaan semula ruang bagi pekali yang sama",
    "Distinguish more spatial computation from more parameters":
      "Bezakan pengiraan ruang yang lebih banyak daripada parameter yang lebih banyak",
  },
  my: {
    "Hi!": "မင်္ဂလာပါ!",
    "Can you say a bit more about that?": "နည်းနည်း ထပ်ပြောပြပေးနိုင်မလား။",
    "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?":
      "ရှင်းပြချက်က အဓိကအယူအဆတွေကို ချိတ်ဆက်ဖို့ ကူညီပါတယ်။ ဥပမာအသစ်ကို ကိုယ်တိုင် စမ်းမလား၊ ဆက်သင်ပေးမလား။",
    "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.":
      "ဥပမာသေးသေးတစ်ခု ရွေးပြီး ဘာဖြစ်သလဲ ပြပေးပါ၊ အဆင့်တိုင်း ဘာကြောင့် ဆက်သွားလဲ ရှင်းပြပါ။ အသေချာဆုံးအပိုင်းကနေ စပါ။",
    "Make it concrete": "အယူအဆကို ပုံသဏ္ဌာန်ဖော်ပါ",
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.":
      "ဥပမာတစ်ခု၊ နှိုင်းယှဉ်ချက်တစ်ခု သို့မဟုတ် အဆင့်လိုက် သရုပ်ပြချက်ဖြင့် Milo ကို သင်ပေးပါ။",
    "Add an example and explain why it fits the concept.":
      "ဥပမာတစ်ခု ထည့်ပြီး ၎င်းသည် အယူအဆနှင့် အဘယ်ကြောင့် ကိုက်ညီကြောင်း ရှင်းပြပါ။",
    Concept: "အယူအဆ",
    Example: "ဥပမာ",
    "Why it fits": "ကိုက်ညီရခြင်း",
    "Input image size": "ထည့်သွင်းပုံ အရွယ်အစား",
    Sequence: "အဆင့်အစဉ်",
    "Selected item": "ရွေးထားသော အရာ",
    "One filter. Many positions.": "စစ်ထုတ်ကိရိယာတစ်ခု။ နေရာများစွာ။",
    "Compare the two image sizes. Tell Milo what changes—and what stays the same.":
      "ပုံအရွယ်အစားနှစ်ခုကို နှိုင်းယှဉ်ပါ။ ဘာတွေ ပြောင်းလဲပြီး ဘာတွေ မပြောင်းဘဲ ရှိသလဲ Milo ကို ပြောပြပါ။",
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled":
      "မှန်ကန်သော convolution · stride 1 · 3×3 kernel · ထည့်သွင်းချန်နယ် 3 · စစ်ထုတ်ကိရိယာ 8 · bias ဖွင့်ထားသည်",
    "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.":
      "stride 1 ဖြစ်သော မှန်ကန်သော convolution တွင် 5×5 kernel၊ ထည့်သွင်းချန်နယ် 2 ခုနှင့် အထွက်စစ်ထုတ်ကိရိယာ 4 ခု၊ bias များ ပါသည်။ 20×20×2 နှင့် 40×40×2 ထည့်သွင်းချက်များကို နှိုင်းယှဉ်ပါ။ တစ်ခုချင်းစီတွင် သင်ယူထားသော ပါရာမီတာ မည်မျှရှိသနည်း၊ ပုံကြီးလာသောအခါ ဘာပြောင်းသနည်း။ အကြောင်းရင်းကို ရှင်းပြပါ။",
    "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters for both inputs. The same coefficients are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4. Multiplications increase from 16 × 16 × 200 = 51,200 to 36 × 36 × 200 = 259,200. This result assumes the convolution architecture stays fixed.":
      "5 × 5 × 2 × 4 = အလေးချိန် 200၊ bias 4 ခု ပေါင်းလျှင် ထည့်သွင်းချက်နှစ်ခုလုံးအတွက် ပါရာမီတာ 204 ခု ဖြစ်သည်။ တူညီသော coefficient များကို နေရာပိုများတွင် ပြန်သုံးသည်။ အထွက်ပုံစံများမှာ 16 × 16 × 4 နှင့် 36 × 36 × 4 ဖြစ်သည်။ မြှောက်ခြင်းအရေအတွက်သည် 16 × 16 × 200 = 51,200 မှ 36 × 36 × 200 = 259,200 သို့ တိုးသည်။ ဤရလဒ်သည် convolution တည်ဆောက်ပုံ မပြောင်းဟု ယူဆသည်။",
    "204 parameters in each case, including biases":
      "bias များ အပါအဝင် ကိစ္စတစ်ခုချင်းစီတွင် ပါရာမီတာ 204 ခု",
    "Explain spatial reuse of the same learned coefficients":
      "သင်ယူထားသော coefficient တူညီချက်များကို နေရာအလိုက် ပြန်သုံးပုံကို ရှင်းပြပါ",
    "Distinguish more spatial computation from more parameters":
      "နေရာအလိုက် တွက်ချက်မှု ပိုများခြင်းနှင့် ပါရာမီတာ ပိုများခြင်းကို ခွဲခြားပါ",
  },
};
