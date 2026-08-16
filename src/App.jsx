import { useEffect, useState } from "react";
import "./App.css";

const API =
  "https://script.google.com/macros/s/AKfycbwfbvdW7QDgbSug7JWCtBQr0ZFDOdkg8_oOzbXF-jO1GAYHMBCRNWBMjKZfU69Ovmbu/exec";


/* =====================================
   判斷是否為新入庫
   購入日期在最近 14 天內
===================================== */

function isNewArrival(purchaseDate) {
  if (!purchaseDate) {
    return false;
  }

  const value = String(purchaseDate).trim();

  let date = null;
  const match = value.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  );

  if (match) {
    date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );
  } else {
    date = new Date(value);
  }

  if (!date || isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();

  today.setHours(23, 59, 59, 999);

  const fourteenDaysAgo = new Date(today);

  fourteenDaysAgo.setDate(
    today.getDate() - 14
  );

  fourteenDaysAgo.setHours(
    0,
    0,
    0,
    0
  );

  return (
    date >= fourteenDaysAgo &&
    date <= today
  );
}


/* =====================================
   解析購入日期
===================================== */

function getPurchaseTime(card) {
  const purchaseDate =
    card.purchaseDate ||
    card["購入日期"] ||
    card.purchase_date ||
    card.purchasedDate ||
    "";

  if (!purchaseDate) {
    return -Infinity;
  }

  const value = String(purchaseDate).trim();
  const match = value.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  );

  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ).getTime();
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return -Infinity;
  }

  return date.getTime();
}


/* =====================================
   App
===================================== */

function App() {

  const [cards, setCards] = useState([]);

  const [keyword, setKeyword] = useState("");

  const [loading, setLoading] = useState(true);

  // 歷史價格
  const [historyCard, setHistoryCard] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 收藏／購買區
  const [sectionFilter, setSectionFilter] = useState("購買");

  // 篩選／排序
  const [typeFilter, setTypeFilter] = useState("全部");


  const [sortKey, setSortKey] = useState("purchaseDate");

  const [sortDirection, setSortDirection] = useState("desc");


  /* =====================================
     讀取 Google Sheet
  ===================================== */

  useEffect(() => {

    fetch(API)

      .then((res) => {

        if (!res.ok) {
          throw new Error("API 讀取失敗");
        }

        return res.json();

      })

      .then((data) => {

        setCards(
          Array.isArray(data)
            ? data
            : []
        );

        setLoading(false);

      })

      .catch((error) => {

        console.error(
          "資料讀取失敗：",
          error
        );

        setLoading(false);

      });

  }, []);


  /* =====================================
     歷史價格
  ===================================== */

  const openHistory = (card) => {

    const cert =
      String(card.cert || "").trim();

    if (!cert) {
      return;
    }

    setHistoryCard(card);
    setHistoryData([]);
    setHistoryLoading(true);

    const historyApi =
      `${API}?action=history&cert=${encodeURIComponent(cert)}&t=${Date.now()}`;

    fetch(historyApi, {
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("歷史價格讀取失敗");
        }

        return res.json();
      })
      .then((data) => {
        setHistoryData(
          Array.isArray(data)
            ? data
            : []
        );

        setHistoryLoading(false);
      })
      .catch((error) => {
        console.error(
          "歷史價格讀取失敗：",
          error
        );

        setHistoryData([]);
        setHistoryLoading(false);
      });
  };

  const closeHistory = () => {
    setHistoryCard(null);
    setHistoryData([]);
    setHistoryLoading(false);
  };


  /* =====================================
     搜尋
  ===================================== */

  const searchedCards = cards.filter((card) => {

    const text =
      keyword
        .trim()
        .toLowerCase();

    if (!text) {
      return true;
    }

    return (

      String(card.name || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.cert || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.type || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.language || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.status || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.title || "")
        .toLowerCase()
        .includes(text)

      ||

      String(card.company || "")
        .toLowerCase()
        .includes(text)

    );

  });


  /* =====================================
     成本／最新成交價解析

     支援 Google Sheet 傳回：
     16000、16,000、$16,000、"16000" 等格式。
  ===================================== */
  const parsePrice = (value) => {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : NaN;
    }

    const cleaned = String(value)
      .trim()
      .replace(/[$,\s]/g, "");

    const number = Number(cleaned);
    return Number.isFinite(number) ? number : NaN;
  };

  /* =====================================
     ⭐ 成本／最新成交價自動分區

     最新成交價 >= 成本價 × 1.10 → 🛒 購買區
     最新成交價 <  成本價 × 1.10 → 🏆 收藏展示區

     最新成交價 >= 成本價 × 1.15 → 🔥 促銷中
     （促銷中的卡片一定會在購買區，並優先顯示）

     成本價／最新成交價無效時，
     才退回 Google Sheet M 欄分類。
  ===================================== */

  const getCostPrice = (card) =>
    parsePrice(
      card.costPrice ??
      card.cost ??
      card.purchaseCost ??
      card["成本價"]
    );

  const getLatestPrice = (card) =>
    parsePrice(card.latestPrice);

  const isPromotion = (card) => {
    const cost = getCostPrice(card);
    const latest = getLatestPrice(card);

    return (
      Number.isFinite(cost) &&
      cost > 0 &&
      Number.isFinite(latest) &&
      latest >= cost * 1.15
    );
  };

  const getSection = (card) => {
    const cost = getCostPrice(card);
    const latest = getLatestPrice(card);

    if (
      Number.isFinite(cost) &&
      cost > 0 &&
      Number.isFinite(latest) &&
      latest > 0
    ) {
      return latest >= cost * 1.10 ? "購買" : "收藏";
    }

    const value =
      String(
        card.category ||
        card.classification ||
        card.section ||
        card["分類"] ||
        ""
      ).trim();

    return value === "收藏" ? "收藏" : "購買";
  };

  /* =====================================
     今日漲跌計算
  ===================================== */

  const getPriceChange = (card) => {
    const latest = Number(card.latestPrice);
    const yesterday = Number(card.yesterdayPrice);

    if (
      !Number.isFinite(latest) ||
      !Number.isFinite(yesterday) ||
      yesterday <= 0
    ) {
      return null;
    }

    const change = latest - yesterday;
    const percent = (change / yesterday) * 100;

    return {
      change,
      percent,
    };
  };


  /* =====================================
     先做搜尋＋類型＋今日漲跌篩選

     這一層是「兩個區域的共同篩選結果」。
     然後再分別計算收藏／購買數量，
     所以切換區域時不會兩邊都顯示 295。
  ===================================== */

  const baseFilteredCards =
    typeFilter === "全部"
      ? searchedCards
      : searchedCards.filter(
          (card) =>
            String(card.type || "").trim() ===
            typeFilter
        );

  /* =====================================
     ⭐ 目前真正套用中的篩選結果

     搜尋、類型都先在這裡完成。
     收藏／購買再從同一份結果切換。
     因此上方張數會跟著搜尋／類型／區域即時更新。
     排序只改順序，不會改變張數。
  ===================================== */

  const filteredBySearchAndType = baseFilteredCards;

  const collectionCount =
    filteredBySearchAndType.filter(
      (card) => getSection(card) === "收藏"
    ).length;

  const purchaseCount =
    filteredBySearchAndType.filter(
      (card) => getSection(card) === "購買"
    ).length;

  const sectionCards =
    filteredBySearchAndType.filter(
      (card) => getSection(card) === sectionFilter
    );

  /* =====================================
     篩選＋排序
  ===================================== */

  const typeOptions = [
    "全部",
    ...Array.from(
      new Set(
        cards
          .map((card) =>
            String(card.type || "").trim()
          )
          .filter(Boolean)
      )
    ).sort((a, b) =>
      a.localeCompare(b, "zh-Hant")
    ),
  ];

  const typeFilteredCards = sectionCards;

  const getSortValue = (card) => {
    if (sortKey === "cert") {
      const value = Number(card.cert);
      return Number.isFinite(value)
        ? value
        : String(card.cert || "");
    }

    if (sortKey === "avgPrice") {
      const value = Number(card.avgPrice);
      return Number.isFinite(value)
        ? value
        : -Infinity;
    }

    if (sortKey === "latestPrice") {
      const value = Number(card.latestPrice);
      return Number.isFinite(value)
        ? value
        : -Infinity;
    }

    if (sortKey === "priceChangePercent") {
      const priceChange = getPriceChange(card);
      return priceChange && Number.isFinite(priceChange.percent)
        ? priceChange.percent
        : -Infinity;
    }

    return getPurchaseTime(card);
  };

  const filteredCards =
    [...typeFilteredCards].sort(
      (a, b) => {
        const aSold =
          String(a.status || "")
            .trim() === "售出";

        const bSold =
          String(b.status || "")
            .trim() === "售出";

        // 售出永遠放最底
        if (aSold && !bSold) {
          return 1;
        }

        if (!aSold && bSold) {
          return -1;
        }

        // 🔥 促銷中永遠優先於一般卡片
        const aPromo = isPromotion(a);
        const bPromo = isPromotion(b);

        if (aPromo && !bPromo) {
          return -1;
        }

        if (!aPromo && bPromo) {
          return 1;
        }

        const aValue = getSortValue(a);
        const bValue = getSortValue(b);

        let result = 0;

        if (
          typeof aValue === "string" ||
          typeof bValue === "string"
        ) {
          result = String(aValue).localeCompare(
            String(bValue),
            "zh-Hant",
            {
              numeric: true,
              sensitivity: "base",
            }
          );
        } else {
          result = aValue - bValue;
        }

        return sortDirection === "asc"
          ? result
          : -result;
      }
    );

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc"
      );
      return;
    }

    setSortKey(key);
    setSortDirection(
      key === "cert"
        ? "asc"
        : "desc"
    );
  };

  const sortArrow = (key) =>
    sortKey === key
      ? sortDirection === "asc"
        ? " ↑"
        : " ↓"
      : "";


  /* =====================================
     ⭐ 全部條件清除
  ===================================== */

  const clearAllFilters = () => {
    setKeyword("");
    setTypeFilter("全部");
    setSectionFilter("購買");
    setSortKey("purchaseDate");
    setSortDirection("desc");
  };


  /* =====================================
     價格格式
  ===================================== */

  const formatPrice = (price) => {

    if (
      price === null ||
      price === undefined ||
      price === ""
    ) {
      return "暫時無資訊";
    }

    const number =
      Number(price);

    if (
      Number.isNaN(number)
    ) {
      return String(price);
    }

    return (
      "$" +
      Math.round(number)
        .toLocaleString("en-US")
    );

  };



  /* =====================================
     統計
  ===================================== */

  /* =====================================
     統計
     只計算目前畫面篩選後的卡片
     ===================================== */

  /* =====================================
     ⭐ 統計：只計算「目前畫面」的卡片
     注意：排序不會影響張數。
     搜尋／類型／收藏購買切換會立即影響張數。
  ===================================== */

  const visibleCards = filteredCards;

  const totalCards = visibleCards.length;

  const soldCards =
    visibleCards.filter(
      (card) =>
        String(card.status || "").trim() === "售出"
    ).length;

  const stockCards =
    visibleCards.filter(
      (card) =>
        String(card.status || "").trim() !== "售出"
    ).length;


  /* =====================================
     畫面
  ===================================== */

  return (

    <div className="app">


      {/* =====================================
          Banner
      ===================================== */}

      <header className="hero-banner">

        <img
          src="/header.png"
          alt="可可庫存一覽表"
        />

      </header>


      {/* =====================================
          搜尋
      ===================================== */}

      <section className="search-area">

        <div className="search-box">

          <span className="search-icon">
            🔍
          </span>

          <input
            type="text"

            value={keyword}

            onChange={(e) => {

              setKeyword(
                e.target.value
              );

            }}

            placeholder="搜尋卡名、PSA 編號、系列、角色、語言..."

          />

        </div>

      </section>


      {/* =====================================
          篩選器／排序
      ===================================== */}

      <section
        style={{
          width: "100%",
          margin: "12px auto 18px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >

        {/* 收藏／購買切換 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px",
            background: "#f4f6fa",
            borderRadius: "14px",
            border: "1px solid #e1e6ef",
          }}
        >

          <button
            type="button"
            onClick={() => setSectionFilter("收藏")}
            style={{
              height: "34px",
              padding: "0 15px",
              border: "none",
              borderRadius: "10px",
              background:
                sectionFilter === "收藏"
                  ? "#fff7d6"
                  : "transparent",
              color:
                sectionFilter === "收藏"
                  ? "#9a6a00"
                  : "#777f8f",
              fontSize: "14px",
              fontWeight: 800,
              cursor: "pointer",
              boxShadow:
                sectionFilter === "收藏"
                  ? "0 2px 7px rgba(80,60,0,0.10)"
                  : "none",
            }}
          >
            🏆 收藏展示 {collectionCount}
          </button>

          <button
            type="button"
            onClick={() => setSectionFilter("購買")}
            style={{
              height: "34px",
              padding: "0 15px",
              border: "none",
              borderRadius: "10px",
              background:
                sectionFilter === "購買"
                  ? "#eaf3ff"
                  : "transparent",
              color:
                sectionFilter === "購買"
                  ? "#1f5fbf"
                  : "#777f8f",
              fontSize: "14px",
              fontWeight: 800,
              cursor: "pointer",
              boxShadow:
                sectionFilter === "購買"
                  ? "0 2px 7px rgba(30,90,170,0.10)"
                  : "none",
            }}
          >
            🛒 購買區 {purchaseCount}
          </button>

        </div>

        {/* 類型篩選 */}
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value)
          }
          style={{
            height: "42px",
            padding: "0 14px",
            border: "1px solid #dfe3eb",
            borderRadius: "12px",
            background: "#ffffff",
            color: "#555467",
            fontSize: "15px",
            fontWeight: 700,
            outline: "none",
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(55,65,90,0.06)",
          }}
        >
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              類型：{type}
            </option>
          ))}
        </select>


        {/* 今日漲跌幅排序 */}
        <button
          type="button"
          onClick={() => handleSort("priceChangePercent")}
          style={{
            height: "42px",
            padding: "0 14px",
            border:
              sortKey === "priceChangePercent"
                ? "1px solid #2874df"
                : "1px solid #dfe3eb",
            borderRadius: "12px",
            background:
              sortKey === "priceChangePercent"
                ? "#eef5ff"
                : "#ffffff",
            color:
              sortKey === "priceChangePercent"
                ? "#1f5fbf"
                : "#555467",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(55,65,90,0.06)",
          }}
        >
          今日漲跌幅{sortArrow("priceChangePercent")}
        </button>

        {/* 編號 */}
        <button
          type="button"
          onClick={() => handleSort("cert")}
          style={{
            height: "42px",
            padding: "0 14px",
            border:
              sortKey === "cert"
                ? "1px solid #2874df"
                : "1px solid #dfe3eb",
            borderRadius: "12px",
            background:
              sortKey === "cert"
                ? "#eef5ff"
                : "#ffffff",
            color:
              sortKey === "cert"
                ? "#1f5fbf"
                : "#555467",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(55,65,90,0.06)",
          }}
        >
          編號{sortArrow("cert")}
        </button>


        {/* 近十筆成交價 */}
        <button
          type="button"
          onClick={() => handleSort("avgPrice")}
          style={{
            height: "42px",
            padding: "0 14px",
            border:
              sortKey === "avgPrice"
                ? "1px solid #2874df"
                : "1px solid #dfe3eb",
            borderRadius: "12px",
            background:
              sortKey === "avgPrice"
                ? "#eef5ff"
                : "#ffffff",
            color:
              sortKey === "avgPrice"
                ? "#1f5fbf"
                : "#555467",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(55,65,90,0.06)",
          }}
        >
          近十筆成交價{sortArrow("avgPrice")}
        </button>


        {/* 最新成交價 */}
        <button
          type="button"
          onClick={() => handleSort("latestPrice")}
          style={{
            height: "42px",
            padding: "0 14px",
            border:
              sortKey === "latestPrice"
                ? "1px solid #2874df"
                : "1px solid #dfe3eb",
            borderRadius: "12px",
            background:
              sortKey === "latestPrice"
                ? "#eef5ff"
                : "#ffffff",
            color:
              sortKey === "latestPrice"
                ? "#1f5fbf"
                : "#555467",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(55,65,90,0.06)",
          }}
        >
          最新成交價{sortArrow("latestPrice")}
        </button>

        {/* ⭐ 全部條件清除 */}
        <button
          type="button"
          onClick={clearAllFilters}
          style={{
            height: "42px",
            padding: "0 14px",
            border: "1px solid #e3b8b8",
            borderRadius: "12px",
            background: "#fff8f8",
            color: "#c65a5a",
            fontSize: "15px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow:
              "0 3px 10px rgba(150,70,70,0.06)",
          }}
        >
          ✕ 清除條件
        </button>


      </section>


      <div
        style={{
          textAlign: "center",
          color: "#9a9aa6",
          fontSize: "13px",
          marginBottom: "8px",
        }}
      >
        目前排序：{
          sortKey === "purchaseDate"
            ? "最新入庫優先"
            : sortKey === "cert"
            ? "編號"
            : sortKey === "avgPrice"
            ? "近十筆成交價"
            : sortKey === "latestPrice"
            ? "最新成交價"
            : "今日漲跌幅"
        }{" "}
        {sortKey !== "purchaseDate" &&
          (sortDirection === "asc"
            ? "小 → 大"
            : "大 → 小")}
      </div>


      {/* =====================================
          Loading
      ===================================== */}

      {loading ? (

        <div className="loading">

          <div className="loading-mascot">
            🐹
          </div>

          <div>
            可可正在整理庫存……
          </div>

        </div>

      ) : (

        <>


          {/* =====================================
              目前區域
          ===================================== */}

          <div
            style={{
              textAlign: "center",
              margin: "4px 0 10px",
              color:
                sectionFilter === "收藏"
                  ? "#9a6a00"
                  : "#1f5fbf",
              fontSize: "22px",
              fontWeight: 900,
            }}
          >
            {sectionFilter === "收藏"
              ? "🏆 收藏展示區"
              : "🛒 購買區"}
          </div>

          {/* =====================================
              庫存統計
          ===================================== */}

          <div
            className="inventory-summary"

            style={{
              display: "flex",

              flexDirection: "column",

              alignItems: "center",

              justifyContent: "center",

              width: "100%",

              textAlign: "center",

              margin: "18px 0 24px",

              gap: "8px",
            }}
          >


            {/* 第一排 */}

            <div
              style={{
                display: "flex",

                alignItems: "baseline",

                justifyContent: "center",

                width: "100%",

                textAlign: "center",
              }}
            >

              <span
                style={{
                  fontSize: "17px",

                  fontWeight: 700,

                  lineHeight: 1,

                  color: "#555b6e",
                }}
              >
                共
              </span>

              <span
                style={{
                  fontSize: "30px",

                  fontWeight: 900,

                  lineHeight: 1,

                  color: "#555b6e",

                  marginLeft: "2px",
                }}
              >
                {totalCards}
              </span>

              <span
                style={{
                  fontSize: "17px",

                  fontWeight: 700,

                  marginLeft: "5px",

                  color: "#6b7280",
                }}
              >
                張卡片
              </span>

            </div>


            {/* 第二排 */}

            <div
              style={{
                display: "flex",

                alignItems: "baseline",

                justifyContent: "center",

                width: "100%",

                textAlign: "center",

                gap: "24px",
              }}
            >


              {/* 在庫 */}

              <div
                style={{
                  display: "flex",

                  alignItems: "baseline",

                  justifyContent: "center",
                }}
              >

                <span
                  style={{
                    fontSize: "15px",

                    marginRight: "4px",
                  }}
                >
                  🟢
                </span>

                <span
                  style={{
                    fontSize: "22px",

                    fontWeight: 900,

                    color: "#16a34a",
                  }}
                >
                  {stockCards}
                </span>

                <span
                  style={{
                    fontSize: "15px",

                    fontWeight: 700,

                    marginLeft: "4px",

                    color: "#6b7280",
                  }}
                >
                  張在庫
                </span>

              </div>


              {/* 售出 */}

              <div
                style={{
                  display: "flex",

                  alignItems: "baseline",

                  justifyContent: "center",
                }}
              >

                <span
                  style={{
                    fontSize: "15px",

                    marginRight: "4px",
                  }}
                >
                  🔴
                </span>

                <span
                  style={{
                    fontSize: "22px",

                    fontWeight: 900,

                    color: "#ef4444",
                  }}
                >
                  {soldCards}
                </span>

                <span
                  style={{
                    fontSize: "15px",

                    fontWeight: 700,

                    marginLeft: "4px",

                    color: "#6b7280",
                  }}
                >
                  張售出
                </span>

              </div>

            </div>

          </div>


          {/* =====================================
              卡片列表
          ===================================== */}

          <main className="cards">

            {filteredCards.map((card) => {


              const isSold =
                String(card.status || "")
                  .trim() === "售出";


              const company =
                String(
                  card.company || ""
                ).trim() ||
                "暫時無資訊";


              const cardTitle =
                String(
                  card.title || ""
                ).trim() ||
                "PSA 鑑定收藏卡";


              const cert =
                card.cert || "-";


              /* 新入庫 */

              const purchaseDate =
                card.purchaseDate ||
                card["購入日期"] ||
                card.purchase_date ||
                card.purchasedDate ||
                "";


              const isNew =
                !isSold &&
                isNewArrival(
                  purchaseDate
                );

              /* ⭐ 促銷中：
                 最新成交價 >= 成本價 × 1.15 */
              const isPromo =
                !isSold &&
                isPromotion(card);


              /* 今日漲跌 */

              const priceChange =
                !isSold
                  ? getPriceChange(card)
                  : null;


              const isUp =
                priceChange &&
                priceChange.change > 0;


              const isDown =
                priceChange &&
                priceChange.change < 0;


              const isFlat =
                priceChange &&
                priceChange.change === 0;


              return (

                <article
                  className={`card ${
                    isSold
                      ? "sold-card"
                      : ""
                  }`}

                  key={`${cert}-${card.name}`}

                  onClick={() => openHistory(card)}

                  role="button"

                  tabIndex={0}

                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" ||
                      event.key === " "
                    ) {
                      event.preventDefault();
                      openHistory(card);
                    }
                  }}

                  style={{
                    cursor: "pointer",
                  }}

                >


                  {/* =================================
                      卡片圖片
                  ================================= */}

                  <div
                    className="card-image"

                    style={{
                      position: "relative",
                      height: "auto",
                      minHeight: 0,
                      overflow: "visible",
                    }}
                  >




                    <img

                      style={{
                        position: "static",
                        display: "block",
                        width: "100%",
                        height: "auto",
                        maxWidth: "100%",
                        maxHeight: "none",
                        objectFit: "contain",
                        objectPosition: "center",
                      }}

                      src={
                        isSold
                          ? "/images/sold.png"
                          : `/images/${cert}.jpg`
                      }

                      alt={
                        card.name ||
                        "可可卡牌"
                      }

                      onError={(e) => {

                        if (
                          !e.currentTarget
                            .dataset
                            .fallback
                        ) {

                          e.currentTarget
                            .dataset
                            .fallback =
                            "true";

                          e.currentTarget.src =
                            "/logo.png";

                        }

                      }}

                    />

                  </div>


                  {/* =================================
                      卡片資訊
                  ================================= */}

                  <div className="card-info">

                    {/* 🔥 促銷中：放在圖片下方，並優先顯示 */}
                    {isPromo && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          margin: "8px auto 4px",
                          padding: "5px 13px",
                          width: "fit-content",
                          background:
                            "linear-gradient(135deg, #ff5a5f 0%, #e53935 100%)",
                          border: "2px solid #ffffff",
                          borderRadius: "9px",
                          color: "#ffffff",
                          boxShadow:
                            "0 2px 7px rgba(220,38,38,0.25)",
                          lineHeight: 1,
                          pointerEvents: "none",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 1000,
                            letterSpacing: "0.3px",
                          }}
                        >
                          🔥
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 900,
                            marginLeft: "4px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          促銷中
                        </span>
                      </div>
                    )}

                    {/* NEW 新入庫：放在圖片下方，不遮住 PSA 條碼 */}
                    {isNew && (

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          margin: "8px auto 4px",
                          padding: "5px 12px",
                          width: "fit-content",
                          background:
                            "linear-gradient(135deg, #FFD84D 0%, #FFBE18 100%)",
                          border: "2px solid #FFFFFF",
                          borderRadius: "9px",
                          color: "#174A91",
                          boxShadow:
                            "0 2px 6px rgba(0,0,0,0.16)",
                          lineHeight: 1,
                          pointerEvents: "none",
                        }}
                      >

                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 1000,
                            letterSpacing: "0.3px",
                          }}
                        >
                          NEW!
                        </span>

                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 900,
                            marginLeft: "5px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          新入庫
                        </span>

                      </div>

                    )}



                    {/* =================================
                        標籤
                    ================================= */}

                    <div
                      className="badges"

                      style={{
                        minHeight: "34px",

                        display: "flex",

                        alignItems: "center",

                        justifyContent:
                          "center",

                        flexWrap: "wrap",

                        gap: "6px",
                      }}
                    >


                      {/* 公司 */}

                      <span
                        className="badge company"

                        style={{
                          background:
                            "#ef4444",

                          color:
                            "#ffffff",

                          fontWeight: 800,

                          borderRadius:
                            "999px",

                          padding:
                            "6px 10px",

                          fontSize:
                            "13px",

                          lineHeight: 1,

                          display:
                            "inline-flex",

                          alignItems:
                            "center",

                          justifyContent:
                            "center",

                          whiteSpace:
                            "nowrap",

                          boxSizing:
                            "border-box",
                        }}
                      >
                        {company}
                      </span>


                      {/* 類型 */}

                      <span
                        className="badge type"
                      >
                        {card.type ||
                          "暫時無資訊"}
                      </span>


                      {/* 語言 */}

                      <span
                        className="badge lang"
                      >
                        {card.language ||
                          "暫時無資訊"}
                      </span>


                      {/* 狀態 */}

                      <span
                        className={`badge ${
                          isSold
                            ? "sold"
                            : "stock"
                        }`}
                      >
                        {isSold
                          ? "售出"
                          : card.status ||
                            "在庫"}
                      </span>

                    </div>


                    {/* =================================
                        卡名
                    ================================= */}

                    <h2 className="card-name">

                      {card.psa ? (

                        <a
                          href={card.psa}

                          onClick={(event) => {
                            event.stopPropagation();
                          }}

                          target="_blank"

                          rel="noreferrer"

                          className="card-name-link"

                          style={{
                            textDecoration:
                              "none",

                            color:
                              "inherit",

                            display:
                              "inline-flex",

                            alignItems:
                              "center",

                            justifyContent:
                              "center",

                            gap: "2px",
                          }}
                        >

                          {card.name ||
                            "未命名卡片"}


                          <span
                            className="card-link-icon"

                            aria-label="查看卡片"

                            style={{
                              textDecoration:
                                "none",

                              display:
                                "inline-block",

                              lineHeight: 1,

                              fontSize:
                                "17px",
                            }}
                          >
                            🔗
                          </span>

                        </a>

                      ) : (

                        <span>
                          {card.name ||
                            "未命名卡片"}
                        </span>

                      )}

                    </h2>


                    {/* =================================
                        鑑定名稱
                    ================================= */}

                    <div
                      className="title"

                      style={{
                        height: "88px",

                        minHeight: "88px",

                        maxHeight: "88px",

                        display: "flex",

                        alignItems:
                          "flex-start",

                        justifyContent:
                          "center",

                        overflow:
                          "hidden",

                        textAlign:
                          "center",

                        boxSizing:
                          "border-box",

                        lineHeight:
                          "1.5",

                        padding:
                          "6px 4px 0",
                      }}
                    >

                      <span
                        style={{
                          display:
                            "-webkit-box",

                          WebkitBoxOrient:
                            "vertical",

                          WebkitLineClamp:
                            5,

                          overflow:
                            "hidden",

                          width:
                            "100%",
                        }}
                      >
                        {cardTitle}
                      </span>

                    </div>


                    {/* =================================
                        售出
                    ================================= */}

                    {isSold && (

                      <div
                        className="sold-text"
                      >
                        ✓ 已售出
                      </div>

                    )}


                    {/* =================================
                        鞋店成交價
                    ================================= */}

                    {!isSold && (

                      <div
                        className="price-box"

                        style={{
                          minHeight:
                            "210px",

                          height:
                            "210px",

                          boxSizing:
                            "border-box",

                          overflow:
                            "hidden",

                          display:
                            "flex",

                          flexDirection:
                            "column",

                          justifyContent:
                            "flex-start",

                          padding:
                            "10px 12px",

                          gap:
                            "2px",
                        }}
                      >


                        {/* 標題 */}

                        <div
                          className="price-company"

                          style={{
                            minHeight:
                              "30px",

                            display:
                              "flex",

                            alignItems:
                              "center",

                            justifyContent:
                              "center",

                            textAlign:
                              "center",

                            color:
                              "#2456a6",

                            fontWeight:
                              800,

                            fontSize:
                              "18px",

                            lineHeight:
                              "1.4",

                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          👟 鞋店成交價
                        </div>


                        {/* 近十筆成交價 */}

                        <div
                          className="price-row"

                          style={{
                            display:
                              "flex",

                            justifyContent:
                              "space-between",

                            alignItems:
                              "center",

                            gap:
                              "8px",

                            width:
                              "100%",

                            minHeight:
                              "34px",

                            boxSizing:
                              "border-box",
                          }}
                        >

                          <span
                            style={{
                              whiteSpace:
                                "nowrap",

                              fontSize:
                                "15px",

                              color:
                                "#7d8494",

                              fontWeight:
                                700,
                            }}
                          >
                            近十筆成交價
                          </span>


                          <strong
                            style={{
                              whiteSpace:
                                "nowrap",

                              fontSize:
                                "20px",

                              color:
                                "#183b77",

                              fontWeight:
                                900,
                            }}
                          >
                            {formatPrice(
                              card.avgPrice
                            )}
                          </strong>

                        </div>


                        {/* 分隔線 */}

                        <div
                          style={{
                            width:
                              "100%",

                            height:
                              "1px",

                            background:
                              "#dbe4f2",

                            flexShrink:
                              0,
                          }}
                        />


                        {/* 最新 */}

                        <div
                          className="price-row"

                          style={{
                            display:
                              "flex",

                            justifyContent:
                              "space-between",

                            alignItems:
                              "center",

                            gap:
                              "8px",

                            width:
                              "100%",

                            minHeight:
                              "34px",

                            boxSizing:
                              "border-box",
                          }}
                        >

                          <span
                            style={{
                              whiteSpace:
                                "nowrap",

                              fontSize:
                                "15px",

                              color:
                                "#7d8494",

                              fontWeight:
                                700,
                            }}
                          >
                            最新
                          </span>


                          <strong
                            style={{
                              whiteSpace:
                                "nowrap",

                              fontSize:
                                "20px",

                              color:
                                "#183b77",

                              fontWeight:
                                900,
                            }}
                          >
                            {formatPrice(
                              card.latestPrice
                            )}
                          </strong>

                        </div>


                        {/* =================================
                            今日漲跌
                        ================================= */}

                        {priceChange && (

                          <div
                            style={{
                              display:
                                "flex",

                              justifyContent:
                                "center",

                              alignItems:
                                "center",

                              gap:
                                "6px",

                              minHeight:
                                "28px",

                              marginTop:
                                "2px",

                              marginBottom:
                                "2px",

                              fontSize:
                                "14px",

                              fontWeight:
                                800,

                              whiteSpace:
                                "nowrap",

                              color:
                                isUp
                                  ? "#ef4444"
                                  : isDown
                                  ? "#16a34a"
                                  : "#8b93a1",
                            }}
                          >

                            <span>
                              {isUp
                                ? "🔴 今日"
                                : isDown
                                ? "🟢 今日"
                                : "⚪ 今日"}
                            </span>


                            <span>
                              {isUp
                                ? "+"
                                : ""}

                              {formatPrice(
                                priceChange.change
                              )}

                            </span>


                            <span>
                              {isUp
                                ? "+"
                                : ""}

                              {priceChange.percent.toFixed(
                                2
                              )}

                              %
                            </span>

                          </div>

                        )}


                        {/* 第一次沒有昨日資料 */}

                        {!priceChange && (

                          <div
                            style={{
                              minHeight:
                                "28px",

                              display:
                                "flex",

                              alignItems:
                                "center",

                              justifyContent:
                                "center",

                              fontSize:
                                "12px",

                              color:
                                "#a1a8b5",

                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            今日漲跌：尚無昨日資料
                          </div>

                        )}


                        {/* 查看成交紀錄 */}

                        {card.shopUrl ? (

                          <a
                            className="button"

                            onClick={(event) => {
                              event.stopPropagation();
                            }}

                            href={
                              card.shopUrl
                            }

                            target="_blank"

                            rel="noreferrer"

                            style={{
                              background:
                                "#16a34a",

                              margin:
                                "0",

                              minHeight:
                                "42px",

                              height:
                                "42px",

                              borderRadius:
                                "11px",

                              display:
                                "flex",

                              alignItems:
                                "center",

                              justifyContent:
                                "center",
                            }}
                          >
                            查看成交紀錄
                          </a>

                        ) : (

                          <div
                            className="button disabled"

                            style={{
                              margin:
                                "0",

                              minHeight:
                                "42px",

                              height:
                                "42px",
                            }}
                          >
                            暫時無資訊
                          </div>

                        )}

                      </div>

                    )}

                  </div>

                </article>

              );

            })}

          </main>


          {/* =====================================
              找不到
          ===================================== */}

          {filteredCards.length === 0 && (

            <div className="empty">

              <div className="empty-mascot">
                🐹
              </div>

              <h2>
                找不到這張卡
              </h2>

              <p>
                換個關鍵字試試看吧！
              </p>

            </div>

          )}

        </>

      )}


      {/* =====================================
          歷史價格
      ===================================== */}

      {historyCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="歷史價格"
          onClick={closeHistory}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
            boxSizing: "border-box",
          }}
        >
          <div
            onClick={(event) => {
              event.stopPropagation();
            }}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "22px",
              boxShadow: "0 20px 60px rgba(15,23,42,0.24)",
              padding: "22px",
              boxSizing: "border-box",
            }}
          >

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#7d8494",
                    fontWeight: 700,
                    marginBottom: "4px",
                  }}
                >
                  📈 歷史價格
                </div>

                <h2
                  style={{
                    margin: 0,
                    color: "#183b77",
                    fontSize: "22px",
                    lineHeight: 1.3,
                  }}
                >
                  {historyCard.name || "收藏卡"}
                </h2>

                <div
                  style={{
                    marginTop: "5px",
                    fontSize: "13px",
                    color: "#8b93a1",
                  }}
                >
                  PSA {historyCard.cert || "-"}
                </div>
              </div>

              <button
                type="button"
                onClick={closeHistory}
                aria-label="關閉歷史價格"
                style={{
                  width: "38px",
                  height: "38px",
                  border: "1px solid #dfe3eb",
                  borderRadius: "50%",
                  background: "#ffffff",
                  color: "#555467",
                  fontSize: "20px",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {historyLoading ? (
              <div
                style={{
                  minHeight: "300px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#7d8494",
                  fontWeight: 700,
                }}
              >
                正在整理歷史價格……
              </div>
            ) : historyData.length === 0 ? (
              <div
                style={{
                  minHeight: "260px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#7d8494",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "42px",
                    marginBottom: "10px",
                  }}
                >
                  📊
                </div>

                <strong>
                  暫時沒有歷史價格
                </strong>

                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "13px",
                  }}
                >
                  每日價格快照建立後，這裡就會出現走勢圖。
                </div>
              </div>
            ) : (
              <>
                {(() => {
                  const values =
                    historyData
                      .map((item) =>
                        Number(item.price)
                      )
                      .filter((value) =>
                        Number.isFinite(value)
                      );

                  const min =
                    Math.min(...values);

                  const max =
                    Math.max(...values);

                  const range =
                    max - min || 1;

                  const width = 700;
                  const height = 320;
                  const left = 54;
                  const right = 18;
                  const top = 24;
                  const bottom = 58;

                  const chartWidth =
                    width - left - right;

                  const chartHeight =
                    height - top - bottom;

                  const points =
                    historyData.map(
                      (item, index) => {

                        const value =
                          Number(item.price);

                        const x =
                          historyData.length === 1
                            ? left + chartWidth / 2
                            : left +
                              (index /
                                (historyData.length - 1)) *
                                chartWidth;

                        const y =
                          top +
                          ((max - value) /
                            range) *
                            chartHeight;

                        return {
                          ...item,
                          value,
                          x,
                          y,
                        };
                      }
                    );

                  const line =
                    points
                      .map(
                        (point, index) =>
                          `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
                      )
                      .join(" ");

                  const area =
                    points.length > 1
                      ? `${line} L ${points[points.length - 1].x.toFixed(2)} ${height - bottom} L ${points[0].x.toFixed(2)} ${height - bottom} Z`
                      : "";

                  const first =
                    points[0];

                  const last =
                    points[points.length - 1];

                  const totalChange =
                    last.value - first.value;

                  const totalPercent =
                    first.value > 0
                      ? (totalChange /
                          first.value) *
                        100
                      : 0;

                  const totalUp =
                    totalChange > 0;

                  const totalDown =
                    totalChange < 0;

                  return (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(3, minmax(0, 1fr))",
                          gap: "8px",
                          marginBottom: "16px",
                        }}
                      >
                        <div
                          style={{
                            background: "#f7f9fc",
                            borderRadius: "14px",
                            padding: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#8b93a1",
                            }}
                          >
                            最新
                          </div>

                          <strong
                            style={{
                              display: "block",
                              marginTop: "3px",
                              color: "#183b77",
                              fontSize: "18px",
                            }}
                          >
                            {formatPrice(last.value)}
                          </strong>
                        </div>

                        <div
                          style={{
                            background: "#f7f9fc",
                            borderRadius: "14px",
                            padding: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#8b93a1",
                            }}
                          >
                            歷史最高
                          </div>

                          <strong
                            style={{
                              display: "block",
                              marginTop: "3px",
                              color: "#183b77",
                              fontSize: "18px",
                            }}
                          >
                            {formatPrice(max)}
                          </strong>
                        </div>

                        <div
                          style={{
                            background: "#f7f9fc",
                            borderRadius: "14px",
                            padding: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#8b93a1",
                            }}
                          >
                            首筆 → 最新
                          </div>

                          <strong
                            style={{
                              display: "block",
                              marginTop: "3px",
                              color: totalUp
                                ? "#ef4444"
                                : totalDown
                                ? "#16a34a"
                                : "#8b93a1",
                              fontSize: "18px",
                            }}
                          >
                            {totalUp ? "+" : ""}
                            {totalPercent.toFixed(2)}%
                          </strong>
                        </div>
                      </div>

                      <div
                        style={{
                          width: "100%",
                          overflow: "hidden",
                          borderRadius: "16px",
                          background: "#fbfcfe",
                          border: "1px solid #e8edf4",
                        }}
                      >
                        <svg
                          viewBox={`0 0 ${width} ${height}`}
                          width="100%"
                          role="img"
                          aria-label={`${historyCard.name || "卡片"}歷史價格走勢圖`}
                          style={{
                            display: "block",
                            width: "100%",
                            height: "auto",
                          }}
                        >
                          <line
                            x1={left}
                            y1={top}
                            x2={left}
                            y2={height - bottom}
                            stroke="#dbe4f2"
                            strokeWidth="1"
                          />

                          <line
                            x1={left}
                            y1={height - bottom}
                            x2={width - right}
                            y2={height - bottom}
                            stroke="#dbe4f2"
                            strokeWidth="1"
                          />

                          <text
                            x={left - 8}
                            y={top + 4}
                            textAnchor="end"
                            fontSize="12"
                            fill="#8b93a1"
                          >
                            {formatPrice(max)}
                          </text>

                          <text
                            x={left - 8}
                            y={height - bottom}
                            textAnchor="end"
                            fontSize="12"
                            fill="#8b93a1"
                          >
                            {formatPrice(min)}
                          </text>

                          {area && (
                            <path
                              d={area}
                              fill="#2874df"
                              opacity="0.08"
                            />
                          )}

                          <path
                            d={line}
                            fill="none"
                            stroke="#2874df"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />

                          {points.map(
                            (point, index) => (
                              <g key={`${point.date}-${index}`}>
                                <circle
                                  cx={point.x}
                                  cy={point.y}
                                  r="5"
                                  fill="#ffffff"
                                  stroke="#2874df"
                                  strokeWidth="3"
                                />

                                <title>
                                  {point.date}：{formatPrice(point.value)}
                                </title>
                              </g>
                            )
                          )}

                          <text
                            x={left}
                            y={height - 18}
                            fontSize="12"
                            fill="#8b93a1"
                          >
                            {first.date}
                          </text>

                          <text
                            x={width - right}
                            y={height - 18}
                            textAnchor="end"
                            fontSize="12"
                            fill="#8b93a1"
                          >
                            {last.date}
                          </text>
                        </svg>
                      </div>

                      <div
                        style={{
                          marginTop: "12px",
                          textAlign: "center",
                          fontSize: "12px",
                          color: "#8b93a1",
                        }}
                      >
                        共 {historyData.length} 筆每日價格快照
                      </div>
                    </>
                  );
                })()}
              </>
            )}

          </div>
        </div>
      )}


      {/* =====================================
          Footer
      ===================================== */}

      <footer className="footer">

        <div>
          🐹
        </div>

        <div>

          <strong>
            可可卡牌 Coco Collectables
          </strong>

          <p>
            Collect what you love.
          </p>

          <button
            type="button"
            onClick={() => {
              clearAllFilters();
              window.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }}
            style={{
              marginTop: "14px",
              padding: "10px 20px",
              border: "1px solid #dfe3eb",
              borderRadius: "12px",
              background: "#ffffff",
              color: "#1f5fbf",
              fontSize: "14px",
              fontWeight: 800,
              cursor: "pointer",
              boxShadow:
                "0 3px 10px rgba(55,65,90,0.08)",
            }}
          >
            🏠 回首頁
          </button>

        </div>

      </footer>

    </div>

  );
}

export default App;