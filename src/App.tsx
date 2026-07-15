import { useMemo, useState } from "react";
import "./App.css";

type Category = {
  id: string;
  label: string;
  icon: string;
};

type Farm = {
  id: number;
  name: string;
  location: string;
  distance: number;
  products: string[];
  categories: string[];
  open: boolean;
  delivery: boolean;
  deliveryRadius?: number;
  whatsapp?: string;
  image: string;
};

const categories: Category[] = [
  { id: "obst", label: "Obst", icon: "🍎" },
  { id: "gemuese", label: "Gemüse", icon: "🥕" },
  { id: "eier", label: "Eier", icon: "🥚" },
  { id: "milch", label: "Milch & Käse", icon: "🧀" },
  { id: "fleisch", label: "Fleisch", icon: "🥩" },
  { id: "honig", label: "Honig", icon: "🍯" },
];

const farms: Farm[] = [
  {
    id: 1,
    name: "Obsthof Plattner",
    location: "Terlan",
    distance: 2.3,
    products: ["Äpfel", "Apfelsaft", "Trockenfrüchte"],
    categories: ["obst"],
    open: true,
    delivery: true,
    deliveryRadius: 10,
    whatsapp: "390000000001",
    image:
      "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: 2,
    name: "Huber Hof",
    location: "Andrian",
    distance: 4.7,
    products: ["Karotten", "Salat", "Kartoffeln"],
    categories: ["gemuese"],
    open: true,
    delivery: true,
    deliveryRadius: 15,
    whatsapp: "390000000002",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: 3,
    name: "Leitner Hof",
    location: "Terlan",
    distance: 6.8,
    products: ["Eier", "Milch", "Joghurt"],
    categories: ["eier", "milch"],
    open: false,
    delivery: false,
    image:
      "https://images.unsplash.com/photo-1506976785307-8732e854ad03?auto=format&fit=crop&w=900&q=80",
  },
];

function App() {
  const [search, setSearch] = useState("");
  const [radius, setRadius] = useState(15);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyDelivery, setOnlyDelivery] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);

  const filteredFarms = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return farms
      .filter((farm) => farm.distance <= radius)
      .filter((farm) => {
        if (selectedCategories.length === 0) return true;

        return selectedCategories.some((category) =>
          farm.categories.includes(category),
        );
      })
      .filter((farm) => !onlyOpen || farm.open)
      .filter((farm) => !onlyDelivery || farm.delivery)
      .filter((farm) => {
        if (!searchTerm) return true;

        const searchableText = [
          farm.name,
          farm.location,
          ...farm.products,
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(searchTerm);
      })
      .sort((a, b) => a.distance - b.distance);
  }, [
    search,
    radius,
    selectedCategories,
    onlyOpen,
    onlyDelivery,
  ]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const toggleFavorite = (farmId: number) => {
    setFavorites((current) =>
      current.includes(farmId)
        ? current.filter((id) => id !== farmId)
        : [...current, farmId],
    );
  };

  const openWhatsApp = (farm: Farm) => {
    if (!farm.whatsapp) return;

    const message = encodeURIComponent(
      `Hallo, ich möchte gerne beim ${farm.name} Produkte vorbestellen.`,
    );

    window.open(
      `https://wa.me/${farm.whatsapp}?text=${message}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">N</div>

          <div>
            <strong>NahVersorgt</strong>
            <span>Direkt vom Bauern.</span>
          </div>
        </div>

        <button className="notification-button" aria-label="Benachrichtigungen">
          🔔
        </button>
      </header>

      <main>
        <section className="hero">
          <span className="eyebrow">Versorgung in deiner Nähe</span>

          <h1>Was gibt es heute direkt vom Hof?</h1>

          <p>
            Finde regionale Produkte, Bauernhöfe und Hofläden in deiner
            Umgebung.
          </p>

          <div className="search-box">
            <span>🔍</span>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Produkte, Höfe oder Orte suchen"
            />
          </div>

          <div className="primary-controls">
            <label className="control">
              <span>📍 Umkreis</span>

              <select
                value={radius}
                onChange={(event) => setRadius(Number(event.target.value))}
              >
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={15}>15 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
              </select>
            </label>

            <button
              className={onlyOpen ? "filter-button active" : "filter-button"}
              onClick={() => setOnlyOpen((value) => !value)}
            >
              🕒 Jetzt geöffnet
            </button>

            <button
              className={
                onlyDelivery ? "filter-button active" : "filter-button"
              }
              onClick={() => setOnlyDelivery((value) => !value)}
            >
              🚚 Lieferung
            </button>
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Produkte auswählen</span>
              <h2>Wonach suchst du?</h2>
            </div>

            {selectedCategories.length > 0 && (
              <button
                className="text-button"
                onClick={() => setSelectedCategories([])}
              >
                Auswahl löschen
              </button>
            )}
          </div>

          <div className="category-list">
            {categories.map((category) => {
              const selected = selectedCategories.includes(category.id);

              return (
                <button
                  key={category.id}
                  className={selected ? "category active" : "category"}
                  onClick={() => toggleCategory(category.id)}
                >
                  <span>{category.icon}</span>
                  {category.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">In deiner Nähe</span>
              <h2>{filteredFarms.length} Höfe gefunden</h2>
            </div>

            <button className="map-button">🗺️ Karte</button>
          </div>

          <div className="farm-list">
            {filteredFarms.map((farm) => {
              const isFavorite = favorites.includes(farm.id);

              return (
                <article className="farm-card" key={farm.id}>
                  <img src={farm.image} alt={farm.name} />

                  <div className="farm-card-content">
                    <div className="farm-card-header">
                      <div>
                        <h3>{farm.name}</h3>
                        <p>
                          {farm.location} · {farm.distance.toFixed(1)} km Fahrt
                        </p>
                      </div>

                      <button
                        className={
                          isFavorite
                            ? "favorite-button active"
                            : "favorite-button"
                        }
                        onClick={() => toggleFavorite(farm.id)}
                        aria-label="Favorit speichern"
                      >
                        {isFavorite ? "♥" : "♡"}
                      </button>
                    </div>

                    <p className="products">{farm.products.join(" · ")}</p>

                    <div className="badges">
                      <span
                        className={
                          farm.open ? "badge open" : "badge closed"
                        }
                      >
                        {farm.open ? "Heute geöffnet" : "Heute geschlossen"}
                      </span>

                      {farm.delivery && (
                        <span className="badge delivery">
                          Lieferung bis {farm.deliveryRadius} km
                        </span>
                      )}
                    </div>

                    <div className="farm-actions">
                      <button className="secondary-button">
                        Hof ansehen
                      </button>

                      {farm.whatsapp && (
                        <button
                          className="primary-button"
                          onClick={() => openWhatsApp(farm)}
                        >
                          Per WhatsApp vorbestellen
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <nav className="bottom-navigation">
        <button className="active">
          <span>⌂</span>
          Start
        </button>

        <button>
          <span>⌕</span>
          Entdecken
        </button>

        <button>
          <span>♡</span>
          Favoriten
        </button>

        <button>
          <span>♙</span>
          Mein Bereich
        </button>
      </nav>
    </div>
  );
}

export default App;