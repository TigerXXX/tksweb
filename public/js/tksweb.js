/*
 * tksweb - Web UI for timesheet entry
 *
 * Copyright (c) 2011-2013 Grant McLean (grant@mclean.net.nz)
 *
 * Dual licensed under the MIT and GPL licenses:
 *   http://www.opensource.org/licenses/mit-license.php
 *   http://www.gnu.org/licenses/gpl.html
 *
 */

(function($) {
    'use strict';

    var TKSWeb = window.TKSWeb = {
        day_name          : [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ],
        month_name        : [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ],
        hour_label_width  : 50,
        hour_label_height : 48,
        day_label_width   : 200,
        day_label_height  : 28,
        duration_unit     : 15
    };
    var keyCode = $.ui.keyCode;
    var week_days, hours, column_for_date;

    function init_hours() {
        hours = [ '' ];
        for(var i = 1; i < 24; i++) {
            hours.push({ hour: pad2(i) + ':00' });
        }
    }

    function init_week_days(days) {
        column_for_date = {};
        week_days       = [];
        for(var i = 0; i < 7; i++) {
            column_for_date[ days[i] ] = i;
            var part = days[i].split('-');
            week_days.push({
                date      : days[i],
                day       : part[2],
                month     : part[1],
                year      : part[0],
                day_name  : TKSWeb.day_name[ i ],
                month_name: TKSWeb.month_name[ parseInt(part[1], 10) - 1 ],
            });
        }
    };

    function pad2(num) {
        return num < 10 ? '0' + num : '' + num;
    }


    var Activity = Backbone.Model.extend({
        defaults: {
            date          : '',
            start_time    : 0,
            duration      : 60,
            wr_number     : '',
            description   : ''
        },
        initialize: function() {
            this.set('column', column_for_date[ this.get('date') ]);
        },
        select: function() {
            this.trigger('selection_changed', this);
            this.set('selected', true);
        },
        unselect: function() {
            this.set('selected', false);
            this.trigger('clear_selection');
        },
        for_edit_dialog: function() {
            var data = this.toJSON();
            data.duration = data.duration / 60;
            return data;
        },
        update_from_editor: function(data) {
            this.set('wr_number', data.wr_number);
            this.set('description', data.description);
            var duration = Math.floor(4 * data.duration) * 15;
            this.set('duration', duration);
            this.save();
        }
    });


    var Activities = Backbone.Collection.extend({
        model: Activity,
        url: '/activity',

        initialize: function() {
            this.on("selection_changed", this.selection_changed);
            this.on("clear_selection", this.clear_selection);
        },
        comparator: function(activity) {
            return activity.get("date") + ' ' +
                   ('0000' + activity.get("start_time")).substr(-4);
        },
        selection_changed: function(new_selection) {
            if(this.current_activity) {
                this.current_activity.unselect();
            }
            this.current_activity = new_selection;
        },
        clear_selection: function() {
            this.current_activity = null;
        },
        find_by_date_time: function(date, time) {
            return this.find(function(activity) {
                if(activity.get("date") !== date) { return false; }
                var start_time = activity.get("start_time");
                var end_time = start_time + activity.get("duration");
                return(start_time <= time && time < end_time);
            });
        },
        editor_active: function() {
            return this.editor.active;
        },
        save_from_editor: function(data) {
            var activity = this.current_activity;
            if(activity) {
                return activity.update_from_editor(data);
            }
            else {
                alert('Need to create from dialog');
            }
        }
    });


    var ActivityView = Backbone.View.extend({
        tagName: 'div',
        className: 'activity',

        events: {
            "click": "select_activity"
        },

        initialize: function() {
            this.week_view = this.model.collection.view;
            this.listenTo(this.model, "change:wr_number change:description", this.render);
            this.listenTo(this.model, "change:duration", this.size_element);
            this.listenTo(this.model, "change:selected", this.show_selection);
            this.position_element();
            this.size_element();
        },

        render: function() {
            var context = this.model.toJSON();
            this.$el.html( this.week_view.activity_template(context) );
            return this;
        },
        position_element: function() {
            var activity = this.model;
            this.$el.css({
                left: activity.get('column') * 200,
                top:  (activity.get('start_time') * TKSWeb.hour_label_height) / 60
            });
        },
        size_element: function() {
            var activity = this.model;
            this.$el.height(activity.get('duration') * TKSWeb.hour_label_height / 60 - 2);
        },
        week_view: function() {
            return this.collection.view;
        },
        select_activity: function() {
            this.model.select();
        },
        show_selection: function() {
            this.$el.toggleClass('selected', this.model.get('selected'));
        }
    });


    var ActivityCursor = Backbone.View.extend({
        events: {
            "dblclick": "dblclick"
        },

        initialize: function() {
            var cursor = this;
            this.init_units();
            this.collection.on("selection_changed", this.selection_changed, cursor);
            this.$el.parent().mousedown( $.proxy(cursor.activities_mousedown, cursor) );
            $(window).keydown( $.proxy(cursor.key_handler, cursor) );
            this.move_to(0, 8 * this.units_per_hour);
        },
        init_units: function() {
            this.x_scale = TKSWeb.day_label_width;
            this.y_scale = TKSWeb.hour_label_height / (60 / TKSWeb.duration_unit);
            this.units_per_hour = 60 / TKSWeb.duration_unit;
            this.max_x = 6;
            this.max_y = 24 * this.units_per_hour - 1;
            this.$el.width(this.x_scale - 2);
            this.size_cursor(1);
        },
        size_cursor: function(h) {
            this.$el.height((h * this.y_scale) - 2);
        },
        move_to: function(x, y) {
            this.x = x;
            this.y = y;
            this.position_cursor();
            this.select_activity_at_cursor();
        },
        move: function(delta_x, delta_y) {
            var new_x = Math.max(0, Math.min(this.x + delta_x, this.max_x));
            var new_y = Math.max(0, Math.min(this.y + delta_y, this.max_y));
            this.move_to(new_x, new_y);
        },
        position_cursor: function() {
            this.$el.css({ left: (this.x * this.x_scale) + 'px', top: (this.y * this.y_scale) + 'px' });
        },
        select_activity_at_cursor: function() {
            var cursor_date = week_days[this.x].date;
            var cursor_time = this.y * TKSWeb.duration_unit;
            var activity = this.collection.find_by_date_time(cursor_date, cursor_time);
            if(activity) {
                activity.select();
            }
            else if(this.collection.current_activity){
                this.collection.current_activity.unselect();
                this.size_cursor(1);
            }
        },
        selection_changed: function(activity) {
            this.x = column_for_date[ activity.get("date") ];
            this.y = activity.get("start_time") / TKSWeb.duration_unit;
            this.position_cursor();
            this.size_cursor( activity.get("duration")  / TKSWeb.duration_unit );
        },
        activities_mousedown: function(e) {
            if(!$(e.target).hasClass('activities')) {
                return;
            }
            e = e.originalEvent;
            var x = (e.layerX || e.offsetX) - TKSWeb.hour_label_width;
            var y = (e.layerY || e.offsetY) - TKSWeb.day_label_height;
            this.move_to(Math.floor(x / this.x_scale), Math.floor(y / this.y_scale));
        },
        key_handler: function(e) {
            if(this.collection.editor_active()) {
                return true;
            }
            var curr = this.collection.current_activity;
            switch(e.keyCode) {
                case keyCode.LEFT:   this.move(-1,  0);    break;
                case keyCode.RIGHT:  this.move( 1,  0);    break;
                case keyCode.ENTER:  edit_activity_at_cursor(e); break;
                case keyCode.UP:
                    this.move(0, -1);
                    break;
                case keyCode.DOWN:
                    this.move(0, curr ? curr.get("duration") / TKSWeb.duration_unit : 1);
                    break;
                case keyCode.DELETE: delete_activity();       break;
                default:
                    if(e.ctrlKey && e.keyCode == 67) {  // Ctrl-C
                        copy_activity();
                    }
                    else if(e.ctrlKey && e.keyCode == 88) {  // Ctrl-X
                        copy_activity();
                        delete_activity();
                    }
                    else if(e.ctrlKey && e.keyCode == 86) {  // Ctrl-V
                        paste_activity();
                    }
                    else if(e.keyCode == 67) {  // C
                        var activity = app.current_activity;
                        var data = current_activity_data();
                        data.bg = (data.bg + 1) % 6;
                        update_activity(data);
                    }
                    else {
                        return;
                    }
                    break;
            }
            e.preventDefault();
        },
        dblclick: function() {
            var curr = this.collection.current_activity;
            if(curr) {
                curr.trigger('start_activity_edit', curr);
            }
        }
    });


    var ActivityEditor = Backbone.View.extend({
        tagName: 'form',
        className: 'tksweb-activity-dialog',

        events: {
            "submit": "enter_pressed"
        },

        initialize: function() {
            this.create_edit_dialog();
            this.activity_dialog_template = Handlebars.compile( $('#activity-dialog-template').html() );
            this.collection.on('start_activity_edit', this.start_activity_edit, this);
        },
        create_edit_dialog: function() {
            var editor = this;
            this.$el.dialog({
                autoOpen:      false,
                resizable:     false,
                closeOnEscape: true,
                width:         360,
                height:        230,
                modal:         true,
                open:          function() { editor.active = true;  },
                close:         function() { editor.active = false; },
                buttons:       {
                    "Ok":     function() { editor.save_activity(); },
                    "Cancel": function() { editor.close(); }
                }

            });
        },
        open: function() {
            this.$el.dialog("open");
        },
        close: function() {
            this.$el.dialog("close");
        },
        start_activity_edit: function(activity) {
            var data = activity.for_edit_dialog();
            this.$el.html( this.activity_dialog_template(data) );
            this.set_title(data.id ? 'Edit Activity' : 'Add Activity');
            this.set_focus(data.wr_number ? '.activity-dc input' : '.activity-wr input');
            this.open();
        },
        set_title: function(new_title) {
            this.$el.dialog('option', 'title', new_title);
        },
        set_focus: function(selector) {
            this.$(selector).focus();
        },
        enter_pressed: function(e) {
            e.preventDefault();
            this.save_activity();
        },
        save_activity: function() {
            this.collection.save_from_editor({
                wr_number   : this.$('.activity-wr input').val(),
                duration    : this.$('.activity-hr input').val(),
                description : this.$('.activity-dc input').val()
            });
            this.close();
        }
    });


    var WeekView = Backbone.View.extend({
        events: {
            "mousewheel .activities": "mousewheel"
        },
        initialize: function(options) {
            var view = this;
            this.compile_templates();
            this.render();
            this.collection.on('add', this.add_activity, this);
            $(window).resize( $.proxy(view.resize, view) );
        },
        compile_templates: function() {
            this.template = Handlebars.compile( $('#week-view-template').html() );
            this.activity_template = Handlebars.compile( $('#activity-template').html() );
        },
        render: function() {
            var context = {
                week_days: week_days,
                hours: hours
            };
            this.$el.html( this.template(context) );
            this.size_activities();
            this.enable_workspace_drag();
            this.resize();
            this.set_initial_scroll();
        },
        size_activities: function() {
            this.activities_width  = TKSWeb.day_label_width * 7;
            this.activities_height = TKSWeb.hour_label_height * 24;
            this.$('.activities')
                .width(this.activities_width)
                .height(this.activities_height);
            this.$('.day-labels')
                .width(this.activities_width);
            this.$('.hour-labels')
                .height(this.activities_height);
        },
        enable_workspace_drag: function() {
            var view = this;
            this.$('.activities').draggable({
                distance: 5,
                drag: function(event, ui) { view.drag( ui.position ); }
            });
        },
        resize: function() {
            this.app_width  = Math.min(this.activities_width, window.innerWidth);
            this.app_height = Math.min(this.activities_height, window.innerHeight);
            this.$el.width( this.app_width ).height( this.app_height );
            this.set_drag_constraints();
        },
        set_drag_constraints: function() {
            this.min_y = this.app_height - this.activities_height - TKSWeb.day_label_height;
            this.max_y = 0;
            this.$('.activities').draggable("option", {
                containment: [
                    this.app_width - this.activities_width - TKSWeb.hour_label_width,
                    this.min_y,
                    1,
                    this.max_y + 1
                ]
            });
        },
        drag: function(pos) {
            this.$('.day-labels ul').css('left', pos.left);
            this.$('.hour-labels ul').css('top', pos.top);
        },
        set_initial_scroll: function() {
            var $activities = this.$('.activities');
            var day_height = (18 - 8) * TKSWeb.hour_label_height;
            var y = -8 * TKSWeb.hour_label_height;
            if(day_height < this.app_height) {
                y = y + (this.app_height - day_height) / 2
            }
            $activities.css('top', y);
            this.$('.hour-labels ul').css('top', y);
        },
        mousewheel: function(e, delta) {
            var $activities = this.$('.activities');
            var y = parseInt($activities.css('top'), 10) + delta * 12;
            y = Math.min( Math.max(y, this.min_y), this.max_y);
            $activities.css('top', y);
            this.$('.hour-labels ul').css('top', y);
        },
        cursor_el: function() {
            return this.$('.activities .cursor');
        },
        add_activity: function(activity) {
            this.$('.activities').append(
                new ActivityView({
                    model: activity
                }).render().el
            );
        }
    });

    TKSWeb.show_week = function (el, days, activities_data) {
        init_week_days(days);
        init_hours();
        var activities = new Activities();
        activities.view = new WeekView({
            el: el,
            monday: days[0],
            collection: activities
        });
        activities.cursor = new ActivityCursor({ collection: activities, el: activities.view.cursor_el() });
        activities.editor = new ActivityEditor({ collection: activities });
        activities.add(activities_data);
    };

})(jQuery);
