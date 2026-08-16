const API =
"https://script.google.com/macros/s/AKfycbwfbvdW7QDgbSug7JWCtBQr0ZFDOdkg8_oOzbXF-jO1GAYHMBCRNWBMjKZfU69Ovmbu/exec";

export async function getCards(){

    const res = await fetch(API);

    if(!res.ok){
        throw new Error("API讀取失敗");
    }

    return await res.json();

}