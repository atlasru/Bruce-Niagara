#pragma once

#include "display.h"

#ifdef BRUCE_NIAGARA_UI
// Native portrait 0 was confirmed on hardware with the wheel above the screen.
constexpr int NIAGARA_WHEEL_BELOW_ROTATION = (BRUCE_NIAGARA_ROTATION + 2) % 4;
int niagaraPortraitRotation();
void saveNiagaraPortraitRotation(int rotation);
// Presentation only: loopOptions retains all selection and input semantics.
void drawNiagaraMenu(int index, const std::vector<Option> &items, uint8_t type,
                     const char *title, unsigned long elapsed);
bool niagaraLabelOverflows(const String &label);
#endif
