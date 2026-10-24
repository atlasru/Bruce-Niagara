#include "niagara_menu.h"

#ifdef BRUCE_NIAGARA_UI
#include <algorithm>
#include <Preferences.h>

namespace {
constexpr int left = 14;
constexpr int textSize = 2;
constexpr int charWidth = 12;

uint16_t mixColor(uint16_t foreground, uint16_t background) {
    const int r = (((foreground >> 11) & 31) * 3 + ((background >> 11) & 31)) / 4;
    const int g = (((foreground >> 5) & 63) * 3 + ((background >> 5) & 63)) / 4;
    const int b = ((foreground & 31) * 3 + (background & 31)) / 4;
    return (r << 11) | (g << 5) | b;
}

uint16_t readableColor(uint16_t color, uint16_t background) {
    if (color != background) return color;
    const int lightness = ((background >> 11) & 31) * 299 +
                          ((background >> 5) & 63) * 587 / 2 + (background & 31) * 114;
    return lightness > 15500 ? TFT_BLACK : TFT_WHITE;
}

int menuBattery() {
    static int percent = -1;
    static unsigned long checked = 0;
    if (percent < 0 || millis() - checked >= 30000) {
        percent = getBattery();
        checked = millis();
    }
    return percent;
}

// Fixed-width font 1 makes clipping independent of the active module's font state.
String visibleLabel(const String &label, int capacity, bool selected, unsigned long elapsed) {
    if (static_cast<int>(label.length()) <= capacity) return label;
    if (!selected || elapsed < 1200) return label.substring(0, capacity - 2) + "..";
    String loop = label + "   " + label;
    int offset = ((elapsed - 1200) / 220) % (label.length() + 3);
    return loop.substring(offset, offset + capacity);
}

template <typename Canvas>
void paint(Canvas &canvas, int index, const std::vector<Option> &items,
           uint8_t type, const char *title, unsigned long elapsed) {
    const int width = tftWidth;
    const int height = tftHeight;
    const uint16_t background = bruceConfig.bgColor;
    const uint16_t foreground = readableColor(bruceConfig.secColor, background);
    const uint16_t accent = readableColor(bruceConfig.priColor, background);
    const uint16_t muted = readableColor(mixColor(foreground, background), background);
    canvas.fillScreen(background);
    if (bruceConfig.theme.border) {
        canvas.drawRoundRect(1, 1, width - 2, height - 2, 4, muted);
    }
    canvas.setTextDatum(0);
    canvas.setTextSize(1);
    canvas.setTextColor(muted, background);
    canvas.drawString(type == MENU_TYPE_MAIN ? "BRUCE / APPS" : "BRUCE / MENU", left, 14, 1);
    String battery = String(menuBattery()) + "%";
    canvas.drawString(battery, width - 38, 14, 1);
    canvas.setTextSize(2);
    canvas.setTextColor(foreground, background);
    String heading = type == MENU_TYPE_MAIN ? "Explore" : String(title);
    if (heading.isEmpty()) heading = "Choose";
    const int headingSize = static_cast<int>(heading.length()) <= (width - 2 * left) / charWidth ? 2 : 1;
    canvas.setTextSize(headingSize);
    if (type != MENU_TYPE_MAIN || bruceConfig.theme.label) {
        canvas.drawString(heading.substring(0, (width - 2 * left) / (6 * headingSize)), left, 37, 1);
    }

    const int top = 78;
    const int rowHeight = 34;
    const int count = static_cast<int>(items.size());
    const int rows = std::max(1, std::min(count, (height - top - 35) / rowHeight));
    const int start = std::max(0, std::min(index - rows / 2, count - rows));
    const int capacity = std::max(3, (width - left - 24) / charWidth);
    for (int row = 0; row < rows; ++row) {
        const int item = start + row;
        const int y = top + row * rowHeight;
        const bool selected = item == index;
        const uint16_t color = !items[item].enabled ? muted : selected ? accent : foreground;
        if (selected) canvas.fillRoundRect(3, y + 1, 3, 19, 1, accent);
        if (items[item].selected) canvas.fillCircle(width - 18, y + 9, 2, accent);
        canvas.setTextSize(textSize);
        canvas.setTextColor(color, background);
        canvas.drawString(visibleLabel(items[item].label, capacity, selected, elapsed), left, y, 1);
    }
    // Position rail, with a minimum thumb size even for very long file lists.
    if (count > rows) {
        const int railHeight = rows * rowHeight - 12;
        const int thumb = std::max(6, railHeight * rows / count);
        canvas.fillRect(width - 5, top, 1, railHeight, muted);
        canvas.fillRoundRect(width - 6, top + (railHeight - thumb) * index / std::max(1, count - 1),
                             3, thumb, 1, accent);
    }
    canvas.setTextSize(1);
    canvas.setTextColor(muted, background);
    canvas.drawString("TURN / PRESS", left, height - 20, 1);
    String position = String(index + 1) + "/" + String(count);
    canvas.drawString(position, width - 8 - position.length() * 6, height - 20, 1);
}
} // namespace

int niagaraPortraitRotation() {
    // A separate preference seeds the corrected orientation on existing installs,
    // while preserving subsequent explicit portrait flips across restarts.
    Preferences preferences;
    int rotation = NIAGARA_WHEEL_BELOW_ROTATION;
    if (preferences.begin("niagara-ui", false)) {
        rotation = preferences.getUChar("rotation", NIAGARA_WHEEL_BELOW_ROTATION);
        preferences.end();
    }
    return rotation == 0 || rotation == 2 ? rotation : NIAGARA_WHEEL_BELOW_ROTATION;
}

void saveNiagaraPortraitRotation(int rotation) {
    if (rotation != 0 && rotation != 2) return;
    Preferences preferences;
    if (preferences.begin("niagara-ui", false)) {
        preferences.putUChar("rotation", rotation);
        preferences.end();
    }
}

bool niagaraLabelOverflows(const String &label) {
    return static_cast<int>(label.length()) > (tftWidth - left - 24) / charWidth;
}

void drawNiagaraMenu(int index, const std::vector<Option> &items, uint8_t type,
                     const char *title, unsigned long elapsed) {
    // A frame is about 109 KB at 170x320. Release it before running any app.
    tft_sprite frame(&tft);
    frame.setColorDepth(16);
    if (frame.createSprite(tftWidth, tftHeight)) {
        paint(frame, index, items, type, title, elapsed);
        frame.pushSprite(0, 0);
        frame.deleteSprite();
    } else {
        // Still usable if a module has left insufficient heap for a framebuffer.
        paint(tft, index, items, type, title, elapsed);
    }
}
#endif
